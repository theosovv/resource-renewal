import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  RenewalJobAction,
  RenewalJobStatus,
  RenewalRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  ClaimedRenewalJob,
  ClaimGuard,
  GuardedWriteResult,
} from './jobs.types.js';

interface ClaimCandidate {
  id: string;
  requestId: string;
  status: RenewalJobStatus;
  nextAction: RenewalJobAction;
  attemptsInCycle: number;
  operationKey: string;
  externalId: string;
  periodMonths: number;
  amountMinor: bigint;
  currency: string;
}

interface ClaimedRow {
  executionVersion: bigint;
  nextAction: RenewalJobAction;
  attemptsInCycle: number;
  totalPostAttempts: number;
}

interface LockedRequestState {
  id: string;
  status: RenewalRequestStatus;
}

interface LockedJobState {
  id: string;
  requestId: string;
  status: RenewalJobStatus;
  executionVersion: bigint;
}

@Injectable()
export class JobsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async claim(leaseOwner: string, leaseMs: number): Promise<ClaimedRenewalJob | null> {
    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<ClaimCandidate[]>(Prisma.sql`
        SELECT
          j.id,
          j.request_id AS "requestId",
          j.status,
          j.next_action AS "nextAction",
          j.attempts_in_cycle AS "attemptsInCycle",
          r.operation_key AS "operationKey",
          resource.external_id AS "externalId",
          r.period_months AS "periodMonths",
          r.amount_minor AS "amountMinor",
          r.currency
        FROM renewal_jobs j
        JOIN renewal_requests r ON r.id = j.request_id
        JOIN resources resource
          ON resource.id = r.resource_id AND resource.workspace_id = r.workspace_id
        WHERE r.status = 'PROCESSING'
          AND (
            (j.status = 'PENDING' AND j.next_attempt_at <= now())
            OR
            (j.status = 'RUNNING' AND j.lease_expires_at <= now())
          )
        ORDER BY j.next_attempt_at, j.id
        LIMIT 1
        FOR UPDATE OF j SKIP LOCKED
      `);
      const candidate = candidates[0];
      if (!candidate) {
        return null;
      }

      const recoveringLease = candidate.status === RenewalJobStatus.RUNNING;
      const action =
        recoveringLease ||
        (candidate.nextAction === RenewalJobAction.POST && candidate.attemptsInCycle >= 3)
          ? RenewalJobAction.RECONCILE
          : candidate.nextAction;
      const claimedRows = await transaction.$queryRaw<ClaimedRow[]>(Prisma.sql`
        UPDATE renewal_jobs
        SET
          status = 'RUNNING',
          next_action = ${action}::renewal_job_action,
          execution_version = execution_version + 1,
          attempts_in_cycle = CASE
            WHEN ${action}::renewal_job_action = 'POST' THEN attempts_in_cycle + 1
            ELSE attempts_in_cycle
          END,
          total_post_attempts = CASE
            WHEN ${action}::renewal_job_action = 'POST' THEN total_post_attempts + 1
            ELSE total_post_attempts
          END,
          lease_owner = ${leaseOwner},
          lease_expires_at = now() + (${leaseMs}::double precision * INTERVAL '1 millisecond'),
          updated_at = now()
        WHERE id = ${candidate.id}::uuid
        RETURNING
          execution_version AS "executionVersion",
          next_action AS "nextAction",
          attempts_in_cycle AS "attemptsInCycle",
          total_post_attempts AS "totalPostAttempts"
      `);
      const claimed = claimedRows[0];
      if (!claimed) {
        throw new Error('Locked renewal job disappeared during claim');
      }
      return {
        jobId: candidate.id,
        requestId: candidate.requestId,
        executionVersion: claimed.executionVersion,
        action: claimed.nextAction,
        attemptsInCycle: claimed.attemptsInCycle,
        totalPostAttempts: claimed.totalPostAttempts,
        operationKey: candidate.operationKey,
        payload: {
          resourceId: candidate.externalId,
          periodMonths: candidate.periodMonths,
          amountMinor: candidate.amountMinor,
          currency: candidate.currency,
        },
      };
    });
  }

  async reschedule(
    guard: ClaimGuard,
    nextAction: RenewalJobAction,
    delayMs: number,
    errorCode: string | null,
  ): Promise<GuardedWriteResult> {
    return this.prisma.$transaction(async (transaction) => {
      const request = await this.lockRequest(transaction, guard.requestId);
      if (!request || request.status === RenewalRequestStatus.COMPLETED) {
        return 'noop';
      }
      const job = await this.lockJob(transaction, guard.jobId);
      if (!this.isCurrentExecution(request, job, guard)) {
        return 'stale';
      }
      const nowRows = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now()`;
      const databaseNow = nowRows[0]?.now;
      if (!databaseNow) {
        throw new Error('PostgreSQL did not return the current time');
      }
      await transaction.renewalJob.update({
        where: { id: guard.jobId },
        data: {
          status: RenewalJobStatus.PENDING,
          nextAction,
          nextAttemptAt: new Date(databaseNow.getTime() + delayMs),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: errorCode,
          updatedAt: databaseNow,
        },
      });
      return 'applied';
    });
  }

  private async lockRequest(
    transaction: Prisma.TransactionClient,
    requestId: string,
  ): Promise<LockedRequestState | null> {
    const rows = await transaction.$queryRaw<LockedRequestState[]>(Prisma.sql`
      SELECT id, status
      FROM renewal_requests
      WHERE id = ${requestId}::uuid
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockJob(
    transaction: Prisma.TransactionClient,
    jobId: string,
  ): Promise<LockedJobState | null> {
    const rows = await transaction.$queryRaw<LockedJobState[]>(Prisma.sql`
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
    request: LockedRequestState,
    job: LockedJobState | null,
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
