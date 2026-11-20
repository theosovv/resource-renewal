import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  RenewalEventActorType,
  RenewalJobAction,
  RenewalJobStatus,
  RenewalRequestStatus,
} from '@prisma/client';
import type { RenewalRequest as StoredRenewalRequest } from '@prisma/client';
import {
  addCalendarDays,
  dateOnlyFromPrisma,
  dateOnlyToPrisma,
} from '../../common/serialization/date-only.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  serializeRenewalRequest,
  serializeRenewalRequestDetail,
  type RenewalRequestDetailResponse,
  type RenewalRequestResponse,
  type RenewalRequestWithDetails,
} from './renewals.serializer.js';

const requestInclude = { job: true } satisfies Prisma.RenewalRequestInclude;
const detailInclude = {
  job: true,
  resource: {
    include: {
      renewalRequests: {
        where: {
          status: {
            in: [
              RenewalRequestStatus.PENDING_APPROVAL,
              RenewalRequestStatus.PROCESSING,
              RenewalRequestStatus.NEEDS_ATTENTION,
            ],
          },
        },
        select: { id: true },
        take: 1,
      },
    },
  },
  events: {
    include: { actorUser: { select: { displayName: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.RenewalRequestInclude;

interface LockedResource {
  id: string;
  workspaceId: string;
  expiresOn: Date;
  amountMinor: bigint;
  currency: string;
}

interface LockedRequest {
  id: string;
  resourceId: string;
  createdBy: string;
  status: RenewalRequestStatus;
  oldExpiry: Date;
  amountMinor: bigint;
  currency: string;
}

export interface RenewalRequestFilters {
  resourceId?: string;
  status?: RenewalRequestStatus;
}

@Injectable()
export class RenewalsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(
    workspaceId: string,
    filters: RenewalRequestFilters,
  ): Promise<{ items: RenewalRequestResponse[]; total: number }> {
    const requests = await this.prisma.renewalRequest.findMany({
      where: {
        workspaceId,
        ...(filters.resourceId ? { resourceId: filters.resourceId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: requestInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return {
      items: requests.map((request) => serializeRenewalRequest(request)),
      total: requests.length,
    };
  }

  async detail(workspaceId: string, requestId: string): Promise<RenewalRequestDetailResponse> {
    const request = await this.prisma.renewalRequest.findFirst({
      where: { id: requestId, workspaceId },
      include: detailInclude,
    });
    if (!request) {
      throw ApiException.requestNotFound();
    }
    return serializeRenewalRequestDetail(request as RenewalRequestWithDetails);
  }

  async create(
    workspaceId: string,
    resourceId: string,
    actorUserId: string,
  ): Promise<RenewalRequestResponse> {
    const request = await this.prisma.$transaction(async (transaction) => {
      const resources = await transaction.$queryRaw<LockedResource[]>(Prisma.sql`
        SELECT
          id,
          workspace_id AS "workspaceId",
          expires_on AS "expiresOn",
          amount_minor AS "amountMinor",
          currency
        FROM resources
        WHERE id = ${resourceId}::uuid AND workspace_id = ${workspaceId}::uuid
        FOR UPDATE
      `);
      const resource = resources[0];
      if (!resource) {
        throw ApiException.resourceNotFound();
      }

      const oldExpiry = dateOnlyFromPrisma(resource.expiresOn);
      const newExpiry = dateOnlyToPrisma(addCalendarDays(oldExpiry, 30));
      const createdRows = await transaction.$queryRaw<StoredRenewalRequest[]>(Prisma.sql`
        INSERT INTO renewal_requests (
          workspace_id,
          resource_id,
          created_by,
          old_expiry,
          new_expiry,
          amount_minor,
          currency,
          operation_key
        )
        VALUES (
          ${workspaceId}::uuid,
          ${resource.id}::uuid,
          ${actorUserId}::uuid,
          ${resource.expiresOn}::date,
          ${newExpiry}::date,
          ${resource.amountMinor},
          ${resource.currency},
          ${randomUUID()}
        )
        ON CONFLICT (resource_id)
        WHERE status IN ('PENDING_APPROVAL', 'PROCESSING', 'NEEDS_ATTENTION')
        DO NOTHING
        RETURNING
          id,
          workspace_id AS "workspaceId",
          resource_id AS "resourceId",
          created_by AS "createdBy",
          decision_by AS "decisionBy",
          status,
          old_expiry AS "oldExpiry",
          new_expiry AS "newExpiry",
          amount_minor AS "amountMinor",
          currency,
          period_months AS "periodMonths",
          operation_key AS "operationKey",
          provider_operation_id AS "providerOperationId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          decided_at AS "decidedAt",
          completed_at AS "completedAt"
      `);
      const created = createdRows[0];
      if (!created) {
        throw ApiException.requestAlreadyActive();
      }
      await transaction.renewalRequestEvent.create({
        data: {
          requestId: created.id,
          actorType: RenewalEventActorType.USER,
          actorUserId,
          fromStatus: null,
          toStatus: RenewalRequestStatus.PENDING_APPROVAL,
        },
      });
      return { ...created, job: null };
    });
    return serializeRenewalRequest(request);
  }

  async approve(
    workspaceId: string,
    requestId: string,
    actorUserId: string,
  ): Promise<RenewalRequestResponse> {
    const request = await this.prisma.$transaction(async (transaction) => {
      const locked = await this.lockRequest(transaction, workspaceId, requestId);
      const resources = await transaction.$queryRaw<LockedResource[]>(Prisma.sql`
        SELECT
          id,
          workspace_id AS "workspaceId",
          expires_on AS "expiresOn",
          amount_minor AS "amountMinor",
          currency
        FROM resources
        WHERE id = ${locked.resourceId}::uuid AND workspace_id = ${workspaceId}::uuid
        FOR UPDATE
      `);
      const resource = resources[0];
      if (!resource) {
        throw ApiException.resourceNotFound();
      }
      if (locked.status !== RenewalRequestStatus.PENDING_APPROVAL) {
        throw ApiException.invalidStateTransition();
      }
      if (locked.createdBy === actorUserId) {
        throw ApiException.selfDecisionForbidden();
      }
      if (
        dateOnlyFromPrisma(resource.expiresOn) !== dateOnlyFromPrisma(locked.oldExpiry) ||
        resource.amountMinor !== locked.amountMinor ||
        resource.currency !== locked.currency
      ) {
        throw ApiException.resourceSnapshotMismatch();
      }

      const now = new Date();
      await transaction.renewalRequest.update({
        where: { id: locked.id },
        data: {
          status: RenewalRequestStatus.PROCESSING,
          decisionBy: actorUserId,
          decidedAt: now,
          updatedAt: now,
        },
      });
      await transaction.renewalJob.create({
        data: { requestId: locked.id },
      });
      await transaction.renewalRequestEvent.create({
        data: {
          requestId: locked.id,
          actorType: RenewalEventActorType.USER,
          actorUserId,
          fromStatus: RenewalRequestStatus.PENDING_APPROVAL,
          toStatus: RenewalRequestStatus.PROCESSING,
        },
      });
      return transaction.renewalRequest.findUniqueOrThrow({
        where: { id: locked.id },
        include: requestInclude,
      });
    });
    return serializeRenewalRequest(request);
  }

  async reject(
    workspaceId: string,
    requestId: string,
    actorUserId: string,
  ): Promise<RenewalRequestResponse> {
    const request = await this.prisma.$transaction(async (transaction) => {
      const locked = await this.lockRequest(transaction, workspaceId, requestId);
      if (locked.status !== RenewalRequestStatus.PENDING_APPROVAL) {
        throw ApiException.invalidStateTransition();
      }
      if (locked.createdBy === actorUserId) {
        throw ApiException.selfDecisionForbidden();
      }

      const now = new Date();
      await transaction.renewalRequest.update({
        where: { id: locked.id },
        data: {
          status: RenewalRequestStatus.REJECTED,
          decisionBy: actorUserId,
          decidedAt: now,
          updatedAt: now,
        },
      });
      await transaction.renewalRequestEvent.create({
        data: {
          requestId: locked.id,
          actorType: RenewalEventActorType.USER,
          actorUserId,
          fromStatus: RenewalRequestStatus.PENDING_APPROVAL,
          toStatus: RenewalRequestStatus.REJECTED,
        },
      });
      return transaction.renewalRequest.findUniqueOrThrow({
        where: { id: locked.id },
        include: requestInclude,
      });
    });
    return serializeRenewalRequest(request);
  }

  async retry(
    workspaceId: string,
    requestId: string,
    actorUserId: string,
  ): Promise<RenewalRequestResponse> {
    const request = await this.prisma.$transaction(async (transaction) => {
      const locked = await this.lockRequest(transaction, workspaceId, requestId);
      if (locked.status !== RenewalRequestStatus.NEEDS_ATTENTION) {
        throw ApiException.invalidStateTransition();
      }
      const jobs = await transaction.$queryRaw<Array<{ id: string; status: RenewalJobStatus }>>(
        Prisma.sql`
          SELECT id, status
          FROM renewal_jobs
          WHERE request_id = ${locked.id}::uuid
          FOR UPDATE
        `,
      );
      const job = jobs[0];
      if (!job || job.status !== RenewalJobStatus.WAITING_MANUAL) {
        throw ApiException.invalidStateTransition();
      }

      const now = new Date();
      await transaction.renewalRequest.update({
        where: { id: locked.id },
        data: { status: RenewalRequestStatus.PROCESSING, updatedAt: now },
      });
      await transaction.renewalJob.update({
        where: { id: job.id },
        data: {
          status: RenewalJobStatus.PENDING,
          nextAction: RenewalJobAction.RECONCILE,
          attemptsInCycle: 0,
          nextAttemptAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        },
      });
      await transaction.renewalRequestEvent.create({
        data: {
          requestId: locked.id,
          actorType: RenewalEventActorType.USER,
          actorUserId,
          fromStatus: RenewalRequestStatus.NEEDS_ATTENTION,
          toStatus: RenewalRequestStatus.PROCESSING,
        },
      });
      return transaction.renewalRequest.findUniqueOrThrow({
        where: { id: locked.id },
        include: requestInclude,
      });
    });
    return serializeRenewalRequest(request);
  }

  private async lockRequest(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    requestId: string,
  ): Promise<LockedRequest> {
    const requests = await transaction.$queryRaw<LockedRequest[]>(Prisma.sql`
      SELECT
        id,
        resource_id AS "resourceId",
        created_by AS "createdBy",
        status,
        old_expiry AS "oldExpiry",
        amount_minor AS "amountMinor",
        currency
      FROM renewal_requests
      WHERE id = ${requestId}::uuid AND workspace_id = ${workspaceId}::uuid
      FOR UPDATE
    `);
    const request = requests[0];
    if (!request) {
      throw ApiException.requestNotFound();
    }
    return request;
  }
}
