import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  RenewalEventActorType,
  RenewalJobStatus,
  RenewalRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ClaimedRenewalJob, ClaimGuard, GuardedWriteResult } from '../jobs/jobs.types.js';
import type { ProviderErrorCode, ProviderOperation } from '../provider/provider.types.js';

export type RenewalExecutionErrorCode =
  | ProviderErrorCode
  | 'RESOURCE_CHANGED_BEFORE_FINALIZE'
  | 'PROVIDER_OPERATION_CONFLICT';

interface LockedRequest {
  id: string;
  workspaceId: string;
  resourceId: string;
  status: RenewalRequestStatus;
  oldExpiry: Date;
  newExpiry: Date;
  amountMinor: bigint;
  currency: string;
  periodMonths: number;
  operationKey: string;
  providerOperationId: string | null;
}

interface LockedJob {
  id: string;
  requestId: string;
  status: RenewalJobStatus;
  executionVersion: bigint;
}

interface LockedResource {
  id: string;
  externalId: string;
}

@Injectable()
export class RenewalExecutionService {
  private readonly logger = new Logger(RenewalExecutionService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async attention(
    guard: ClaimGuard,
    errorCode: RenewalExecutionErrorCode,
  ): Promise<GuardedWriteResult> {
    return this.prisma.$transaction(async (transaction) => {
      const request = await this.lockRequest(transaction, guard.requestId);
      if (!request) {
        return 'stale';
      }
      if (request.status === RenewalRequestStatus.COMPLETED) {
        return 'noop';
      }
      const job = await this.lockJob(transaction, guard.jobId);
      if (!job || !this.isCurrentExecution(request, job, guard)) {
        return 'stale';
      }
      await this.writeAttention(transaction, request.id, job.id, errorCode);
      return 'applied';
    });
  }

  async finalize(
    claim: ClaimedRenewalJob,
    operation: ProviderOperation,
  ): Promise<GuardedWriteResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const request = await this.lockRequest(transaction, claim.requestId);
        if (!request) {
          return 'stale';
        }
        if (request.status === RenewalRequestStatus.COMPLETED) {
          if (request.providerOperationId === operation.operationId) {
            return 'noop';
          }
          this.logger.warn(
            `Ignored a different provider operation for COMPLETED request ${request.id}`,
          );
          return 'stale';
        }
        const job = await this.lockJob(transaction, claim.jobId);
        if (!job || !this.isCurrentExecution(request, job, claim)) {
          return 'stale';
        }
        const resources = await transaction.$queryRaw<LockedResource[]>(Prisma.sql`
          SELECT id, external_id AS "externalId"
          FROM resources
          WHERE id = ${request.resourceId}::uuid AND workspace_id = ${request.workspaceId}::uuid
          FOR UPDATE
        `);
        const resource = resources[0];
        if (!resource || !this.matchesImmutableRequest(request, resource, claim, operation)) {
          await this.writeAttention(
            transaction,
            request.id,
            job.id,
            'PROVIDER_RESULT_MISMATCH',
          );
          return 'applied';
        }

        const updatedResources = await transaction.$executeRaw(Prisma.sql`
          UPDATE resources
          SET expires_on = ${request.newExpiry}::date, updated_at = now()
          WHERE id = ${request.resourceId}::uuid
            AND workspace_id = ${request.workspaceId}::uuid
            AND expires_on = ${request.oldExpiry}::date
            AND amount_minor = ${request.amountMinor}
            AND currency = ${request.currency}
        `);
        if (updatedResources !== 1) {
          await this.writeAttention(
            transaction,
            request.id,
            job.id,
            'RESOURCE_CHANGED_BEFORE_FINALIZE',
          );
          return 'applied';
        }

        const now = new Date();
        await transaction.renewalRequest.update({
          where: { id: request.id },
          data: {
            status: RenewalRequestStatus.COMPLETED,
            providerOperationId: operation.operationId,
            completedAt: now,
            updatedAt: now,
          },
        });
        await transaction.renewalJob.update({
          where: { id: job.id },
          data: {
            status: RenewalJobStatus.SUCCEEDED,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
            completedAt: now,
            updatedAt: now,
          },
        });
        await transaction.renewalRequestEvent.create({
          data: {
            requestId: request.id,
            actorType: RenewalEventActorType.SYSTEM,
            actorUserId: null,
            fromStatus: RenewalRequestStatus.PROCESSING,
            toStatus: RenewalRequestStatus.COMPLETED,
            reasonCode: null,
          },
        });
        return 'applied';
      });
    } catch (error) {
      if (this.isProviderOperationUniqueViolation(error)) {
        return this.attention(claim, 'PROVIDER_OPERATION_CONFLICT');
      }
      throw error;
    }
  }

  private isProviderOperationUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }
    if (error.code === 'P2010') {
      return (
        error.meta?.code === '23505' &&
        error.meta?.constraint === 'renewal_requests_provider_operation_key'
      );
    }
    if (error.code !== 'P2002') {
      return false;
    }
    const target = error.meta?.target;
    return (
      target === 'provider_operation_id' ||
      target === 'renewal_requests_provider_operation_key' ||
      (Array.isArray(target) && target.length === 1 && target[0] === 'provider_operation_id')
    );
  }

  private async writeAttention(
    transaction: Prisma.TransactionClient,
    requestId: string,
    jobId: string,
    errorCode: RenewalExecutionErrorCode,
  ): Promise<void> {
    const now = new Date();
    await transaction.renewalRequest.update({
      where: { id: requestId },
      data: { status: RenewalRequestStatus.NEEDS_ATTENTION, updatedAt: now },
    });
    await transaction.renewalJob.update({
      where: { id: jobId },
      data: {
        status: RenewalJobStatus.WAITING_MANUAL,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
        updatedAt: now,
      },
    });
    await transaction.renewalRequestEvent.create({
      data: {
        requestId,
        actorType: RenewalEventActorType.SYSTEM,
        actorUserId: null,
        fromStatus: RenewalRequestStatus.PROCESSING,
        toStatus: RenewalRequestStatus.NEEDS_ATTENTION,
        reasonCode: errorCode,
      },
    });
  }

  private matchesImmutableRequest(
    request: LockedRequest,
    resource: LockedResource,
    claim: ClaimedRenewalJob,
    operation: ProviderOperation,
  ): boolean {
    return (
      request.operationKey === claim.operationKey &&
      resource.externalId === claim.payload.resourceId &&
      request.periodMonths === claim.payload.periodMonths &&
      request.amountMinor === claim.payload.amountMinor &&
      request.currency === claim.payload.currency &&
      operation.status === 'completed' &&
      operation.startedCount === 1 &&
      operation.operationId.trim().length > 0 &&
      operation.resourceId === resource.externalId &&
      operation.periodMonths === request.periodMonths &&
      BigInt(operation.amountMinor) === request.amountMinor &&
      operation.currency === request.currency
    );
  }

  private async lockRequest(
    transaction: Prisma.TransactionClient,
    requestId: string,
  ): Promise<LockedRequest | null> {
    const rows = await transaction.$queryRaw<LockedRequest[]>(Prisma.sql`
      SELECT
        id,
        workspace_id AS "workspaceId",
        resource_id AS "resourceId",
        status,
        old_expiry AS "oldExpiry",
        new_expiry AS "newExpiry",
        amount_minor AS "amountMinor",
        currency,
        period_months AS "periodMonths",
        operation_key AS "operationKey",
        provider_operation_id AS "providerOperationId"
      FROM renewal_requests
      WHERE id = ${requestId}::uuid
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockJob(
    transaction: Prisma.TransactionClient,
    jobId: string,
  ): Promise<LockedJob | null> {
    const rows = await transaction.$queryRaw<LockedJob[]>(Prisma.sql`
      SELECT
        id,
        request_id AS "requestId",
        status,
        execution_version AS "executionVersion"
      FROM renewal_jobs
      WHERE id = ${jobId}::uuid
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private isCurrentExecution(
    request: LockedRequest,
    job: LockedJob | null,
    guard: ClaimGuard,
  ): boolean {
    return (
      request.status === RenewalRequestStatus.PROCESSING &&
      job?.requestId === guard.requestId &&
      job.status === RenewalJobStatus.RUNNING &&
      job.executionVersion === guard.executionVersion
    );
  }
}
