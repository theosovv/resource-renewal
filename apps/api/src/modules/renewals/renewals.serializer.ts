import type {
  RenewalJob,
  RenewalRequest,
  RenewalRequestEvent,
} from '@prisma/client';
import type { components } from '@resource-renewal/contracts';
import { dateOnlyFromPrisma } from '../../common/serialization/date-only.js';
import { minorUnitsToJsonNumber } from '../../common/serialization/minor-units.js';
import {
  serializeResource,
  type ResourceWithActiveRequests,
} from '../resources/resources.serializer.js';

export type RenewalRequestResponse = components['schemas']['RenewalRequest'];
export type RenewalRequestDetailResponse = components['schemas']['RenewalRequestDetail'];
export type RenewalRequestWithJob = RenewalRequest & { job: RenewalJob | null };
export type RenewalRequestWithDetails = RenewalRequestWithJob & {
  resource: ResourceWithActiveRequests;
  events: Array<
    RenewalRequestEvent & { actorUser: { displayName: string } | null }
  >;
};

export function serializeRenewalRequest(
  request: RenewalRequestWithJob,
): RenewalRequestResponse {
  return {
    id: request.id,
    workspaceId: request.workspaceId,
    resourceId: request.resourceId,
    createdBy: request.createdBy,
    decisionBy: request.decisionBy,
    status: request.status,
    snapshot: {
      oldExpiry: dateOnlyFromPrisma(request.oldExpiry),
      newExpiry: dateOnlyFromPrisma(request.newExpiry),
      amountMinor: minorUnitsToJsonNumber(request.amountMinor),
      currency: 'RUB',
      periodMonths: 1,
    },
    operationKey: request.operationKey,
    providerOperationId: request.providerOperationId,
    execution: request.job
      ? {
          status: request.job.status,
          attemptsInCycle: request.job.attemptsInCycle,
          totalPostAttempts: request.job.totalPostAttempts,
          nextAttemptAt: request.job.nextAttemptAt.toISOString(),
          lastErrorCode: request.job.lastErrorCode,
        }
      : null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() ?? null,
    completedAt: request.completedAt?.toISOString() ?? null,
  };
}

export function serializeRenewalRequestDetail(
  request: RenewalRequestWithDetails,
): RenewalRequestDetailResponse {
  return {
    ...serializeRenewalRequest(request),
    resource: serializeResource(request.resource),
    history: request.events.map((event) => ({
      id: event.id,
      actorType: event.actorType,
      actorUserId: event.actorUserId,
      actorDisplayName: event.actorUser?.displayName ?? null,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      reasonCode: event.reasonCode,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
