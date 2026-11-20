import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import type { WorkspaceRole } from './auth.types.js';
import { WorkspaceAccessGuard } from './workspace-access.guard.js';
import { WORKSPACE_ROLE_KEY } from './workspace-access.metadata.js';

export function RequireWorkspaceRole(role?: WorkspaceRole): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(WORKSPACE_ROLE_KEY, role),
    UseGuards(WorkspaceAccessGuard),
  );
}
