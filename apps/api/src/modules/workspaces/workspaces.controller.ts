import { Controller, Get, Req } from '@nestjs/common';
import type { components } from '@resource-renewal/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types.js';

type Workspace = components['schemas']['Workspace'];

@Controller('workspaces')
export class WorkspacesController {
  @Get()
  list(@Req() request: AuthenticatedRequest): { items: Workspace[] } {
    return {
      items: request.authContext.user.memberships.map((membership) => ({
        id: membership.workspaceId,
        code: membership.workspaceCode,
        name: membership.workspaceName,
        roles: membership.roles,
      })),
    };
  }
}
