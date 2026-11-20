import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedDatabase } from '../../../prisma/seed.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  login,
  seedPasswords,
  WEB_ORIGIN,
  type SeedEmail,
} from './test-app.js';

function expectProblem(body: unknown, status: number, code: string): void {
  expect(body).toMatchObject({ status, code });
  expect((body as { message?: unknown }).message).toEqual(expect.any(String));
}

function tokenHash(cookiePair: string): string {
  const rawToken = cookiePair.slice('rr_session='.length);
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

async function currentDatabaseTime(prisma: PrismaService): Promise<Date> {
  const rows = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`;
  const value = rows[0]?.now;
  if (!value) {
    throw new Error('Database clock returned no value');
  }
  return value;
}

describe('M1 authentication and access (HTTP + real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeEach(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('TC-AUTH-001: protected data requires a session', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401)
      .expect('Content-Type', /application\/problem\+json/);
    expectProblem(response.body, 401, 'UNAUTHORIZED');
    expect(response.body).not.toHaveProperty('user');
    expect(response.body).not.toHaveProperty('memberships');
  });

  it('TC-AUTH-002: malformed, unknown and revoked tokens are rejected', async () => {
    for (const cookie of ['rr_session=not-valid', `rr_session=${'A'.repeat(43)}`]) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', cookie)
        .expect(401);
      expectProblem(response.body, 401, 'UNAUTHORIZED');
    }

    const fixture = await login(app, 'initiator.alpha@example.test');
    const session = await prisma.authSession.findUniqueOrThrow({
      where: { tokenHash: tokenHash(fixture.cookiePair) },
    });
    await prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const revoked = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', fixture.cookiePair)
      .expect(401);
    expectProblem(revoked.body, 401, 'UNAUTHORIZED');
    expect(revoked.headers['set-cookie']?.[0]).toContain('rr_session=');
    expect(revoked.headers['set-cookie']?.[0]).toMatch(/Expires=/i);
  });

  const accountExpectations: Array<[SeedEmail, string, string[]]> = [
    ['initiator.alpha@example.test', 'ALPHA', ['INITIATOR']],
    ['approver.alpha@example.test', 'ALPHA', ['APPROVER']],
    ['initiator.beta@example.test', 'BETA', ['INITIATOR']],
    ['universal.alpha@example.test', 'ALPHA', ['INITIATOR', 'APPROVER']],
  ];

  it.each(accountExpectations)(
    'TC-AUTH-003: %s receives server-derived identity and memberships',
    async (email, workspaceCode, roles) => {
      const fixture = await login(app, email);
      expect(fixture.user.email).toBe(email);
      expect(fixture.user.memberships).toHaveLength(1);
      expect(fixture.user.memberships[0]).toMatchObject({ workspaceCode, roles });
      expect(fixture.csrfToken).toMatch(/^[0-9a-f]{64}$/);
      expect(fixture.user).not.toHaveProperty('passwordHash');
      expect(fixture.user).not.toHaveProperty('tokenHash');
      expect(JSON.stringify(fixture.user)).not.toContain(fixture.cookiePair.split('=')[1]);

      const csrf = await fixture.agent.get('/api/v1/auth/csrf').expect(200);
      expect(csrf.headers['cache-control']).toBe('no-store');
      expect(csrf.body).toEqual({ csrfToken: fixture.csrfToken });
      const sessions = await prisma.authSession.findMany({ where: { userId: fixture.user.id } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.userId).toBe(fixture.user.id);
    },
  );

  it('TC-AUTH-003: every repeated login creates an independent session', async () => {
    const first = await login(app, 'initiator.alpha@example.test');
    const second = await login(app, 'initiator.alpha@example.test');
    expect(second.cookiePair).not.toBe(first.cookiePair);
    expect(second.csrfToken).not.toBe(first.csrfToken);
    expect(await prisma.authSession.count({ where: { userId: first.user.id } })).toBe(2);
    await first.agent.get('/api/v1/auth/me').expect(200);
    await second.agent.get('/api/v1/auth/me').expect(200);
  });

  it('TC-AUTH-004 (login): authority fields are rejected without creating a session', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({
        email: 'initiator.alpha@example.test',
        password: seedPasswords['initiator.alpha@example.test'],
        role: 'APPROVER',
        workspace: 'ALPHA',
        userId: crypto.randomUUID(),
      })
      .expect(400);
    expectProblem(response.body, 400, 'VALIDATION_ERROR');
    expect(await prisma.authSession.count()).toBe(0);

    const fixture = await login(app, 'initiator.alpha@example.test');
    expect(fixture.user.memberships[0]?.roles).toEqual(['INITIATOR']);
    expect(fixture.user.memberships[0]?.workspaceCode).toBe('ALPHA');
  });

  it('TC-AUTH-005: DB-clock cookie/session attributes, SHA-256 at rest and API restart', async () => {
    const databaseTimeBeforeLogin = await currentDatabaseTime(prisma);
    let fixture: Awaited<ReturnType<typeof login>>;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
    try {
      fixture = await login(app, 'initiator.alpha@example.test');
    } finally {
      vi.useRealTimers();
    }
    const databaseTimeAfterLogin = await currentDatabaseTime(prisma);
    expect(fixture.setCookie).toMatch(/HttpOnly/i);
    expect(fixture.setCookie).toMatch(/SameSite=Lax/i);
    expect(fixture.setCookie).toMatch(/Path=\//i);
    expect(fixture.setCookie).not.toMatch(/Domain=/i);
    expect(fixture.setCookie).not.toMatch(/Secure/i);

    const rawToken = fixture.cookiePair.slice('rr_session='.length);
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const session = await prisma.authSession.findUniqueOrThrow({
      where: { tokenHash: tokenHash(fixture.cookiePair) },
    });
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.tokenHash).not.toBe(rawToken);
    expect(JSON.stringify(session)).not.toContain(rawToken);
    expect(JSON.stringify(session)).not.toContain(fixture.csrfToken);
    expect(session.createdAt.getTime()).toBeGreaterThanOrEqual(databaseTimeBeforeLogin.getTime());
    expect(session.createdAt.getTime()).toBeLessThanOrEqual(databaseTimeAfterLogin.getTime());
    expect(session.lastSeenAt).toEqual(session.createdAt);
    expect(session.absoluteExpiresAt.getTime() - session.createdAt.getTime()).toBe(28_800_000);
    const cookieExpires = /Expires=([^;]+)/i.exec(fixture.setCookie)?.[1];
    if (!cookieExpires) {
      throw new Error('Session cookie has no absolute Expires attribute');
    }
    expect(Math.floor(new Date(cookieExpires).getTime() / 1000)).toBe(
      Math.floor(session.absoluteExpiresAt.getTime() / 1000),
    );

    const absoluteExpiry = session.absoluteExpiresAt;
    await app.close();
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', fixture.cookiePair)
      .expect(200);
    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.body).toMatchObject({ id: fixture.user.id, email: fixture.user.email });
    const afterRestart = await prisma.authSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(afterRestart.absoluteExpiresAt).toEqual(absoluteExpiry);
  });

  it('TC-AUTH-005: COOKIE_SECURE=true adds Secure', async () => {
    const secureApp = await createTestApp({ COOKIE_SECURE: true });
    try {
      const response = await request(secureApp.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', WEB_ORIGIN)
        .send({
          email: 'initiator.alpha@example.test',
          password: seedPasswords['initiator.alpha@example.test'],
        })
        .expect(200);
      expect(response.headers['set-cookie']?.[0]).toMatch(/Secure/i);
    } finally {
      await secureApp.close();
    }
  });

  it('TC-AUTH-006: logout revokes only the current session and clears its cookie', async () => {
    const first = await login(app, 'initiator.alpha@example.test');
    const second = await login(app, 'initiator.alpha@example.test');
    const firstHash = tokenHash(first.cookiePair);
    const secondHash = tokenHash(second.cookiePair);

    const logout = await first.agent
      .post('/api/v1/auth/logout')
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', first.csrfToken)
      .expect(204);
    expect(logout.headers['cache-control']).toBe('no-store');
    expect(logout.headers['set-cookie']?.[0]).toContain('rr_session=');
    expect(logout.headers['set-cookie']?.[0]).toMatch(/Expires=/i);

    const firstSession = await prisma.authSession.findUniqueOrThrow({
      where: { tokenHash: firstHash },
    });
    const secondSession = await prisma.authSession.findUniqueOrThrow({
      where: { tokenHash: secondHash },
    });
    expect(firstSession.revokedAt).not.toBeNull();
    expect(secondSession.revokedAt).toBeNull();

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', first.cookiePair)
      .expect(401);
    await second.agent.get('/api/v1/auth/me').expect(200);
  });

  it('TC-AUTH-007: activity slides only idle expiry and idle expiry is enforced', async () => {
    const fixture = await login(app, 'initiator.alpha@example.test');
    const hash = tokenHash(fixture.cookiePair);
    const original = await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hash } });
    const previousLastSeen = new Date(Date.now() - 600_000);
    const previousIdleExpiry = new Date(Date.now() + 60_000);
    await prisma.authSession.update({
      where: { id: original.id },
      data: { lastSeenAt: previousLastSeen, idleExpiresAt: previousIdleExpiry },
    });

    await fixture.agent.get('/api/v1/auth/me').expect(200);
    const active = await prisma.authSession.findUniqueOrThrow({ where: { id: original.id } });
    expect(active.lastSeenAt.getTime()).toBeGreaterThan(previousLastSeen.getTime());
    expect(active.idleExpiresAt.getTime()).toBeGreaterThan(previousIdleExpiry.getTime());
    expect(active.absoluteExpiresAt).toEqual(original.absoluteExpiresAt);

    await prisma.authSession.update({
      where: { id: original.id },
      data: {
        lastSeenAt: new Date(Date.now() - 60_000),
        idleExpiresAt: new Date(Date.now() - 1000),
      },
    });
    const expired = await fixture.agent.get('/api/v1/auth/me').expect(401);
    expect(expired.headers['set-cookie']?.[0]).toContain('rr_session=');
    expect(await prisma.authSession.count({ where: { id: original.id } })).toBe(1);
  });

  it('TC-AUTH-007: absolute expiry wins despite a future idle expiry', async () => {
    const fixture = await login(app, 'initiator.alpha@example.test');
    const session = await prisma.authSession.findUniqueOrThrow({
      where: { tokenHash: tokenHash(fixture.cookiePair) },
    });
    await prisma.authSession.update({
      where: { id: session.id },
      data: {
        createdAt: new Date(Date.now() - 7_200_000),
        lastSeenAt: new Date(),
        idleExpiresAt: new Date(Date.now() + 3_600_000),
        absoluteExpiresAt: new Date(Date.now() - 3_600_000),
      },
    });

    const response = await fixture.agent.get('/api/v1/auth/me').expect(401);
    expectProblem(response.body, 401, 'UNAUTHORIZED');
    expect(response.headers['set-cookie']?.[0]).toContain('rr_session=');
    expect(await prisma.authSession.count({ where: { id: session.id } })).toBe(1);
  });

  it('TC-AUTH-008 (logout): CSRF is required, session-bound and checked before revocation', async () => {
    const first = await login(app, 'initiator.alpha@example.test');
    const second = await login(app, 'initiator.alpha@example.test');
    const hash = tokenHash(first.cookiePair);

    for (const csrfToken of [undefined, '0'.repeat(64), second.csrfToken]) {
      let pending = first.agent.post('/api/v1/auth/logout').set('Origin', WEB_ORIGIN);
      if (csrfToken) {
        pending = pending.set('X-CSRF-Token', csrfToken);
      }
      const response = await pending.expect(403);
      expectProblem(response.body, 403, 'CSRF_INVALID');
      const session = await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hash } });
      expect(session.revokedAt).toBeNull();
    }

    await first.agent
      .post('/api/v1/auth/logout')
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', first.csrfToken)
      .expect(204);
    const revoked = await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hash } });
    expect(revoked.revokedAt).not.toBeNull();
  });

  it('TC-AUTH-009: cross-site requests are rejected and configured CORS is explicit', async () => {
    for (const headers of [
      { Origin: 'https://attacker.test' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set(headers)
        .send({
          email: 'initiator.alpha@example.test',
          password: seedPasswords['initiator.alpha@example.test'],
        })
        .expect(403);
      expectProblem(response.body, 403, 'FORBIDDEN');
    }
    expect(await prisma.authSession.count()).toBe(0);

    const fixture = await login(app, 'initiator.alpha@example.test');
    const mutation = await fixture.agent
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://attacker.test')
      .set('X-CSRF-Token', fixture.csrfToken)
      .expect(403);
    expectProblem(mutation.body, 403, 'FORBIDDEN');
    const session = await prisma.authSession.findUniqueOrThrow({
      where: { tokenHash: tokenHash(fixture.cookiePair) },
    });
    expect(session.revokedAt).toBeNull();

    const preflight = await request(app.getHttpServer())
      .options('/api/v1/auth/logout')
      .set('Origin', WEB_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'X-CSRF-Token')
      .expect(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    expect(preflight.headers['access-control-allow-origin']).not.toBe('*');
    expect(preflight.headers['access-control-allow-headers']).toMatch(/X-CSRF-Token/i);

    const deniedPreflight = await request(app.getHttpServer())
      .options('/api/v1/auth/logout')
      .set('Origin', 'https://attacker.test')
      .set('Access-Control-Request-Method', 'POST');
    expect(deniedPreflight.headers['access-control-allow-origin']).not.toBe(WEB_ORIGIN);
    expect(deniedPreflight.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('TC-AUTH-009: login requires JSON content type', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .set('Content-Type', 'text/plain')
      .send('initiator.alpha@example.test')
      .expect(400);
    expectProblem(response.body, 400, 'VALIDATION_ERROR');
    expect(await prisma.authSession.count()).toBe(0);
  });

  it('TC-AUTH-010: user deactivation invalidates the existing cookie', async () => {
    const fixture = await login(app, 'initiator.alpha@example.test');
    await prisma.user.update({
      where: { id: fixture.user.id },
      data: { isActive: false },
    });
    const response = await fixture.agent.get('/api/v1/auth/me').expect(401);
    expectProblem(response.body, 401, 'UNAUTHORIZED');
  });

  it('TC-AUTH-010: membership deletion survives repeated seed and forbids the old cookie', async () => {
    const fixture = await login(app, 'initiator.alpha@example.test');
    const membership = fixture.user.memberships[0];
    if (!membership) {
      throw new Error('Seed membership is missing');
    }
    await prisma.workspaceMembership.delete({
      where: {
        workspaceId_userId: {
          workspaceId: membership.workspaceId,
          userId: fixture.user.id,
        },
      },
    });
    await seedDatabase(prisma);
    await seedDatabase(prisma);
    expect(
      await prisma.workspaceMembership.count({
        where: { workspaceId: membership.workspaceId, userId: fixture.user.id },
      }),
    ).toBe(0);

    const response = await fixture.agent
      .get(`/api/v1/test-only/workspaces/${membership.workspaceId}/access`)
      .expect(403);
    expectProblem(response.body, 403, 'FORBIDDEN');
    const me = await fixture.agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.memberships).toEqual([]);
    const workspaces = await fixture.agent.get('/api/v1/workspaces').expect(200);
    expect(workspaces.headers['cache-control']).toBe('no-store');
    expect(workspaces.body).toEqual({ items: [] });
  });

  it('TC-AUTH-010: a role downgrade forbids the previous guarded action with the old cookie', async () => {
    const fixture = await login(app, 'universal.alpha@example.test');
    const membership = fixture.user.memberships[0];
    if (!membership) {
      throw new Error('Seed membership is missing');
    }
    const path = `/api/v1/test-only/workspaces/${membership.workspaceId}/initiate`;
    await fixture.agent
      .post(path)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', fixture.csrfToken)
      .send({})
      .expect(200);

    await prisma.workspaceMembership.update({
      where: {
        workspaceId_userId: {
          workspaceId: membership.workspaceId,
          userId: fixture.user.id,
        },
      },
      data: { canInitiate: false, canApprove: true },
    });
    const response = await fixture.agent
      .post(path)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', fixture.csrfToken)
      .send({})
      .expect(403);
    expectProblem(response.body, 403, 'FORBIDDEN');
    const me = await fixture.agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.memberships[0].roles).toEqual(['APPROVER']);
  });
});
