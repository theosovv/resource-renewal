import { Inject, Injectable } from '@nestjs/common';
import { RenewalRequestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { ApiException } from '../../common/errors/api.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  serializeResource,
  type ResourceResponse,
  type ResourceWithActiveRequests,
} from './resources.serializer.js';

const activeRequestWhere = {
  status: {
    in: [
      RenewalRequestStatus.PENDING_APPROVAL,
      RenewalRequestStatus.PROCESSING,
      RenewalRequestStatus.NEEDS_ATTENTION,
    ],
  },
} satisfies Prisma.RenewalRequestWhereInput;

const activeRequestInclude = {
  renewalRequests: {
    where: activeRequestWhere,
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.ResourceInclude;

@Injectable()
export class ResourcesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(workspaceId: string): Promise<{ items: ResourceResponse[] }> {
    const resources = await this.prisma.resource.findMany({
      where: { workspaceId },
      include: activeRequestInclude,
      orderBy: [{ externalId: 'asc' }, { id: 'asc' }],
    });
    return {
      items: resources.map((resource) =>
        serializeResource(resource as ResourceWithActiveRequests),
      ),
    };
  }

  async detail(workspaceId: string, resourceId: string): Promise<ResourceResponse> {
    const resource = await this.prisma.resource.findFirst({
      where: { id: resourceId, workspaceId },
      include: activeRequestInclude,
    });
    if (!resource) {
      throw ApiException.resourceNotFound();
    }
    return serializeResource(resource as ResourceWithActiveRequests);
  }
}
