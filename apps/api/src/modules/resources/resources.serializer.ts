import type { Resource as PrismaResource } from '@prisma/client';
import type { components } from '@resource-renewal/contracts';
import { dateOnlyFromPrisma } from '../../common/serialization/date-only.js';
import { minorUnitsToJsonNumber } from '../../common/serialization/minor-units.js';

export type ResourceResponse = components['schemas']['Resource'];
export type ResourceWithActiveRequests = PrismaResource & {
  renewalRequests: Array<{ id: string }>;
};

export function serializeResource(resource: ResourceWithActiveRequests): ResourceResponse {
  return {
    id: resource.id,
    workspaceId: resource.workspaceId,
    externalId: resource.externalId,
    name: resource.name,
    expiresOn: dateOnlyFromPrisma(resource.expiresOn),
    amountMinor: minorUnitsToJsonNumber(resource.amountMinor),
    currency: 'RUB',
    activeRequestId: resource.renewalRequests[0]?.id ?? null,
  };
}
