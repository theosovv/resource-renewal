import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../src/modules/auth/auth.types.js';
import { RequireWorkspaceRole } from '../src/modules/auth/workspace-access.decorator.js';

@Controller('test-only/workspaces')
export class WorkspaceAccessProbeController {
  @Get(':workspaceId/access')
  @RequireWorkspaceRole()
  membership(@Req() request: AuthenticatedRequest): { workspaceId: string } {
    return { workspaceId: this.membershipWorkspace(request) };
  }

  @Post(':workspaceId/initiate')
  @HttpCode(200)
  @RequireWorkspaceRole('INITIATOR')
  initiate(@Req() request: AuthenticatedRequest): { workspaceId: string } {
    return { workspaceId: this.membershipWorkspace(request) };
  }

  private membershipWorkspace(request: AuthenticatedRequest): string {
    const workspaceId = request.workspaceMembership?.workspaceId;
    if (!workspaceId) {
      throw new Error('Workspace guard did not attach a membership');
    }
    return workspaceId;
  }
}
