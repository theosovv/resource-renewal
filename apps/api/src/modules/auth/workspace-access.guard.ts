import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../../common/errors/api.exception.js';
import type { AuthenticatedRequest, WorkspaceRole } from './auth.types.js';
import { WORKSPACE_ROLE_KEY } from './workspace-access.metadata.js';

@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const workspaceId = request.params.workspaceId;
    const membership = request.authContext?.user.memberships.find(
      (candidate) => candidate.workspaceId === workspaceId,
    );
    if (!membership) {
      throw ApiException.forbidden();
    }

    const requiredRole = this.reflector.getAllAndOverride<WorkspaceRole | undefined>(
      WORKSPACE_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredRole && !membership.roles.includes(requiredRole)) {
      throw ApiException.forbidden();
    }

    request.workspaceMembership = membership;
    return true;
  }
}
