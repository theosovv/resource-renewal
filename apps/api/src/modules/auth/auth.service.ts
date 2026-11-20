import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { verify } from 'argon2';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthContext, CurrentUser, Membership, WorkspaceRole } from './auth.types.js';

interface UserIdentity {
  id: string;
  email: string;
  displayName: string;
}

interface SessionActivityRow extends UserIdentity {
  sessionId: string;
  tokenHash: string;
}

interface CreatedSessionRow {
  id: string;
  absoluteExpiresAt: Date;
}

export interface LoginResult {
  rawToken: string;
  absoluteExpiresAt: Date;
  context: AuthContext;
}

@Injectable()
export class AuthService {
  private readonly idleTtlSeconds: number;
  private readonly absoluteTtlSeconds: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.idleTtlSeconds = config.getOrThrow<number>('SESSION_IDLE_TTL_SECONDS');
    this.absoluteTtlSeconds = config.getOrThrow<number>('SESSION_ABSOLUTE_TTL_SECONDS');
  }

  async login(email: string, password: string): Promise<LoginResult | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        displayName: true,
        passwordHash: true,
        isActive: true,
      },
    });
    if (!user?.isActive || !(await this.verifyPassword(user.passwordHash, password))) {
      return null;
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const sessions = await this.prisma.$queryRaw<CreatedSessionRow[]>(Prisma.sql`
      INSERT INTO auth_sessions (
        user_id,
        token_hash,
        created_at,
        last_seen_at,
        idle_expires_at,
        absolute_expires_at
      )
      VALUES (
        CAST(${user.id} AS UUID),
        ${tokenHash},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP + (${this.idleTtlSeconds} * INTERVAL '1 second'),
        CURRENT_TIMESTAMP + (${this.absoluteTtlSeconds} * INTERVAL '1 second')
      )
      RETURNING id, absolute_expires_at AS "absoluteExpiresAt"
    `);
    const session = sessions[0];
    if (!session) {
      throw new Error('Session insert returned no row');
    }

    return {
      rawToken,
      absoluteExpiresAt: session.absoluteExpiresAt,
      context: await this.createContext(session.id, tokenHash, user),
    };
  }

  async authenticate(rawToken: string): Promise<AuthContext | null> {
    const tokenHash = this.hashToken(rawToken);
    const rows = await this.prisma.$queryRaw<SessionActivityRow[]>(Prisma.sql`
      UPDATE auth_sessions AS session
      SET
        last_seen_at = CURRENT_TIMESTAMP,
        idle_expires_at = LEAST(
          CURRENT_TIMESTAMP + (${this.idleTtlSeconds} * INTERVAL '1 second'),
          session.absolute_expires_at
        )
      FROM users AS authenticated_user
      WHERE authenticated_user.id = session.user_id
        AND authenticated_user.is_active = TRUE
        AND session.token_hash = ${tokenHash}
        AND session.revoked_at IS NULL
        AND session.idle_expires_at > CURRENT_TIMESTAMP
        AND session.absolute_expires_at > CURRENT_TIMESTAMP
      RETURNING
        session.id AS "sessionId",
        session.token_hash AS "tokenHash",
        authenticated_user.id AS "id",
        authenticated_user.email,
        authenticated_user.display_name AS "displayName"
    `);
    const row = rows[0];
    if (!row) {
      return null;
    }

    return this.createContext(row.sessionId, row.tokenHash, row);
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createContext(
    sessionId: string,
    tokenHash: string,
    identity: UserIdentity,
  ): Promise<AuthContext> {
    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { userId: identity.id },
      select: {
        workspaceId: true,
        canInitiate: true,
        canApprove: true,
        workspace: { select: { code: true, name: true } },
      },
      orderBy: { workspace: { code: 'asc' } },
    });

    const mappedMemberships: Membership[] = memberships.map((membership) => {
      const roles: WorkspaceRole[] = [];
      if (membership.canInitiate) {
        roles.push('INITIATOR');
      }
      if (membership.canApprove) {
        roles.push('APPROVER');
      }
      return {
        workspaceId: membership.workspaceId,
        workspaceCode: membership.workspace.code,
        workspaceName: membership.workspace.name,
        roles,
      };
    });

    const user: CurrentUser = {
      id: identity.id,
      email: identity.email,
      displayName: identity.displayName,
      memberships: mappedMemberships,
    };
    return { sessionId, tokenHash, user };
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }

  private async verifyPassword(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
