import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { RequireWorkspaceRole } from '../auth/workspace-access.decorator.js';
import type { ResourceResponse } from './resources.serializer.js';
import { ResourcesService } from './resources.service.js';

@Controller('workspaces/:workspaceId/resources')
@RequireWorkspaceRole()
export class ResourcesController {
  constructor(@Inject(ResourcesService) private readonly resources: ResourcesService) {}

  @Get()
  list(@Param('workspaceId', ParseUUIDPipe) workspaceId: string): Promise<{ items: ResourceResponse[] }> {
    return this.resources.list(workspaceId);
  }

  @Get(':resourceId')
  detail(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('resourceId', ParseUUIDPipe) resourceId: string,
  ): Promise<ResourceResponse> {
    return this.resources.detail(workspaceId, resourceId);
  }
}
