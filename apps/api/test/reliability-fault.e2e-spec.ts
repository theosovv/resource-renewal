import type { INestApplication } from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  RenewalEventActorType,
  RenewalJobAction,
  RenewalJobStatus,
  RenewalRequestStatus,
} from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../src/modules/jobs/jobs.service.js';
import { RenewalExecutionService } from '../src/modules/renewals/renewal-execution.service.js';
import {
  completedProviderResponse,
  startFaultProvider,
  type FaultProvider,
} from './fault-provider.js';
import {
  approveRequest,
  createRequestById,
  createRequestForResource,
  loginUser,
  retryRequest,
  startReliabilityApp,
} from './reliability-helpers.js';
import { waitForValue } from './wait-for-value.js';

const prisma = new PrismaClient();

describe('M3 worker protocol with a contract-compatible fault provider', () => {
  let app: INestApplication | null = null;
  let provider: FaultProvider | null = null;

  beforeEach(async () => {
    provider = await startFaultProvider();
  });

  afterEach(async () => {
    await app?.close();
    app = null;
    await provider?.close();
    provider = null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    'TC-REL-008/009/010/011: three uncertain POSTs lead to attention; GET and manual retry preserve counters/key',
    async () => {
      app = await startReliabilityApp(provider!.baseUrl, {
        PROVIDER_TIMEOUT_MS: 100,
        WORKER_POLL_INTERVAL_MS: 20,
        RENEWAL_RETRY_DELAY_MS: 40,
        RENEWAL_JOB_LEASE_MS: 1_000,
      });
      const initiator = await loginUser(app, 'initiator.alpha@example.test');
      const approver = await loginUser(app, 'approver.alpha@example.test');
      const created = await createRequestForResource(prisma, initiator);
      await approveRequest(approver, created);

      await waitForValue(
        async () => {
          const stored = await prisma.renewalRequest.findUnique({ where: { id: created.id } });
          return stored?.status === RenewalRequestStatus.NEEDS_ATTENTION ? stored : null;
        },
        { description: 'NEEDS_ATTENTION after three POSTs and final reconciliation' },
      );
      expect(provider!.postCalls).toHaveLength(3);
      expect(provider!.getCalls).toHaveLength(3);
      expect(provider!.postCalls.every((call) => call.key === created.operationKey)).toBe(true);
      expect(provider!.getCalls.every((key) => key === created.operationKey)).toBe(true);
      for (const call of provider!.postCalls) {
        expect(call.payload).toEqual({
          resource_id: 'res-a-01',
          period_months: 1,
          amount_minor: 128000,
          currency: 'RUB',
        });
      }
      const attentionJob = await prisma.renewalJob.findUniqueOrThrow({
        where: { requestId: created.id },
      });
      expect(attentionJob).toMatchObject({
        status: RenewalJobStatus.WAITING_MANUAL,
        attemptsInCycle: 3,
        totalPostAttempts: 3,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: 'PROVIDER_NOT_FOUND',
      });
      expect(
        await prisma.renewalRequestEvent.count({
          where: {
            requestId: created.id,
            actorType: RenewalEventActorType.SYSTEM,
            toStatus: RenewalRequestStatus.NEEDS_ATTENTION,
          },
        }),
      ).toBe(1);
      await expect(app.get(JobsService).claim('must-not-claim', 1_000)).resolves.toBeNull();
      expect(provider!.postCalls).toHaveLength(3);

      await app.close();
      app = await startReliabilityApp(provider!.baseUrl, { WORKER_ENABLED: false });
      const retryInitiator = await loginUser(app, 'initiator.alpha@example.test');
      const retryApprover = await loginUser(app, 'approver.alpha@example.test');
      const retryResponse = await retryRequest(retryApprover, created).expect(200);
      expect(retryResponse.body).toMatchObject({
        status: RenewalRequestStatus.PROCESSING,
        operationKey: created.operationKey,
        execution: {
          status: RenewalJobStatus.PENDING,
          attemptsInCycle: 0,
          totalPostAttempts: 3,
        },
      });
      const retryJob = await prisma.renewalJob.findUniqueOrThrow({
        where: { requestId: created.id },
      });
      expect(retryJob.nextAction).toBe(RenewalJobAction.RECONCILE);
      expect(retryJob.leaseOwner).toBeNull();
      expect(retryJob.executionVersion).toBe(attentionJob.executionVersion);

      const duplicate = await createRequestById(
        retryInitiator,
        created.workspaceId,
        created.resourceId,
      ).expect(409);
      expect(duplicate.body.code).toBe('REQUEST_ALREADY_ACTIVE');
      await retryRequest(retryApprover, created).expect(409);
      expect(provider!.postCalls).toHaveLength(3);
      expect(await prisma.renewalJob.count({ where: { requestId: created.id } })).toBe(1);

      await app.close();
      provider!.setGetHandler((key) => {
        const originalPost = provider!.postCalls.find((call) => call.key === key);
        if (!originalPost) {
          return { status: 404, body: { error: 'not_found' } };
        }
        return completedProviderResponse(originalPost, 'manual-retry-provider-operation');
      });
      app = await startReliabilityApp(provider!.baseUrl, {
        PROVIDER_TIMEOUT_MS: 100,
        WORKER_POLL_INTERVAL_MS: 20,
        RENEWAL_RETRY_DELAY_MS: 40,
        RENEWAL_JOB_LEASE_MS: 1_000,
      });
      await waitForValue(
        async () => {
          const stored = await prisma.renewalRequest.findUnique({ where: { id: created.id } });
          return stored?.status === RenewalRequestStatus.COMPLETED ? stored : null;
        },
        { description: 'completion through manual RECONCILE without another POST' },
      );
      expect(provider!.postCalls).toHaveLength(3);
      expect(provider!.getCalls.length).toBeGreaterThan(3);
      expect(
        await prisma.renewalRequest.findUniqueOrThrow({ where: { id: created.id } }),
      ).toMatchObject({
        operationKey: created.operationKey,
        providerOperationId: 'manual-retry-provider-operation',
        status: RenewalRequestStatus.COMPLETED,
      });
      expect(
        await prisma.renewalJob.findUniqueOrThrow({ where: { requestId: created.id } }),
      ).toMatchObject({
        status: RenewalJobStatus.SUCCEEDED,
        attemptsInCycle: 0,
        totalPostAttempts: 3,
      });
      expect(
        (await prisma.resource.findUniqueOrThrow({ where: { id: created.resourceId } })).expiresOn
          .toISOString()
          .slice(0, 10),
      ).toBe('2027-03-31');
      expect(
        await prisma.renewalRequestEvent.count({ where: { requestId: created.id } }),
      ).toBe(5);
    },
    30_000,
  );

  it.each([
    { getOutcome: '404' as const },
    { getOutcome: 'timeout' as const },
  ])(
    'TC-REL-019: jobs are claimable after uncertain POST and reconciliation $getOutcome',
    async ({ getOutcome }) => {
      provider!.setGetHandler(async () => {
        if (getOutcome === 'timeout') {
          await new Promise((resolve) => setTimeout(resolve, 150));
          return { status: 503, body: { error: 'late_timeout_response' } };
        }
        return { status: 404, body: { error: 'not_found' } };
      });
      app = await startReliabilityApp(provider!.baseUrl, {
        PROVIDER_TIMEOUT_MS: 50,
        WORKER_POLL_INTERVAL_MS: 1_000,
        RENEWAL_RETRY_DELAY_MS: 250,
        RENEWAL_JOB_LEASE_MS: 1_000,
      });
      const initiator = await loginUser(app, 'initiator.alpha@example.test');
      const approver = await loginUser(app, 'approver.alpha@example.test');
      const created = await createRequestForResource(prisma, initiator);
      await approveRequest(approver, created);

      await waitForValue(
        async () => {
          const job = await prisma.renewalJob.findUnique({ where: { requestId: created.id } });
          return job?.status === RenewalJobStatus.PENDING &&
            job.nextAction === RenewalJobAction.RECONCILE
            ? job
            : null;
        },
        { description: 'PENDING/RECONCILE with persisted delay' },
      );
      const rescheduled = await waitForValue(
        async () => {
          const job = await prisma.renewalJob.findUnique({ where: { requestId: created.id } });
          return job?.status === RenewalJobStatus.PENDING &&
            job.nextAction === RenewalJobAction.POST &&
            job.leaseOwner === null &&
            job.leaseExpiresAt === null
            ? job
            : null;
        },
        { description: `PENDING/POST after GET ${getOutcome}` },
      );
      expect(rescheduled.totalPostAttempts).toBe(1);
      expect(rescheduled.lastErrorCode).toBe(
        getOutcome === '404' ? 'PROVIDER_NOT_FOUND' : 'PROVIDER_UNCERTAIN',
      );
      if (getOutcome === '404') {
        expect(rescheduled.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());
      } else {
        expect(rescheduled.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      }
      await waitForValue(
        async () => (provider!.postCalls.length >= 2 ? provider!.postCalls : null),
        { description: 'next due POST claim' },
      );
    },
    20_000,
  );

  it('TC-REL-017: concurrent create/finalize can never persist a pre-completion snapshot', async () => {
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    provider!.setPostHandler(async (call) => {
      await providerGate;
      return completedProviderResponse(call, 'racing-provider-operation');
    });
    app = await startReliabilityApp(provider!.baseUrl, {
      PROVIDER_TIMEOUT_MS: 1_000,
      WORKER_POLL_INTERVAL_MS: 20,
      RENEWAL_JOB_LEASE_MS: 2_000,
    });
    const initiator = await loginUser(app, 'initiator.alpha@example.test');
    const approver = await loginUser(app, 'approver.alpha@example.test');
    const created = await createRequestForResource(prisma, initiator);
    await approveRequest(approver, created);
    await waitForValue(async () => (provider!.postCalls.length === 1 ? true : null), {
      description: 'provider response gate',
    });

    let notifyExternalLock!: () => void;
    const externalLockAcquired = new Promise<void>((resolve) => {
      notifyExternalLock = resolve;
    });
    let releaseExternalLock!: () => void;
    const externalLockGate = new Promise<void>((resolve) => {
      releaseExternalLock = resolve;
    });
    const externalTransaction = prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw(Prisma.sql`
          SELECT id FROM resources WHERE id = ${created.resourceId}::uuid FOR UPDATE
        `);
        notifyExternalLock();
        await externalLockGate;
      },
      { timeout: 10_000 },
    );
    await externalLockAcquired;
    releaseProvider();
    await waitForValue(
      async () => {
        const waiting = await prisma.$queryRaw<Array<{ pid: number }>>(Prisma.sql`
          SELECT pid
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND state = 'active'
            AND wait_event_type = 'Lock'
            AND query LIKE '%external_id AS "externalId"%'
        `);
        return waiting.length > 0 ? true : null;
      },
      { description: 'finalization waiting for the resource row lock' },
    );

    const createPromise = createRequestById(
      initiator,
      created.workspaceId,
      created.resourceId,
    ).then((response) => response);
    await waitForValue(
      async () => {
        const waiting = await prisma.$queryRaw<Array<{ pid: number }>>(Prisma.sql`
          SELECT pid
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND state = 'active'
            AND wait_event_type = 'Lock'
            AND query LIKE '%workspace_id AS "workspaceId"%'
            AND query LIKE '%FOR UPDATE%'
        `);
        return waiting.length > 0 ? true : null;
      },
      { description: 'create waiting for the same resource row lock' },
    );
    releaseExternalLock();
    await externalTransaction;
    const racingCreate = await createPromise;
    await waitForValue(
      async () => {
        const stored = await prisma.renewalRequest.findUnique({ where: { id: created.id } });
        return stored?.status === RenewalRequestStatus.COMPLETED ? stored : null;
      },
      { description: 'racing finalization' },
    );
    if (racingCreate.status === 201) {
      expect(racingCreate.body.snapshot).toMatchObject({
        oldExpiry: '2027-03-31',
        newExpiry: '2027-04-30',
      });
      expect(racingCreate.body.status).toBe(RenewalRequestStatus.PENDING_APPROVAL);
    } else {
      expect(racingCreate.status).toBe(409);
      expect(racingCreate.body.code).toBe('REQUEST_ALREADY_ACTIVE');
    }
    expect(
      (await prisma.resource.findUniqueOrThrow({ where: { id: created.resourceId } })).expiresOn
        .toISOString()
        .slice(0, 10),
    ).toBe('2027-03-31');
    expect(provider!.postCalls).toHaveLength(1);
    expect(
      await prisma.renewalRequestEvent.count({
        where: { requestId: created.id, toStatus: RenewalRequestStatus.COMPLETED },
      }),
    ).toBe(1);
  });

  it.each([
    {
      name: 'payload conflict',
      response: { status: 409, body: { error: 'idempotency_key_conflict' } },
      errorCode: 'PROVIDER_PAYLOAD_CONFLICT',
    },
    {
      name: 'result mismatch',
      response: {
        status: 200,
        body: {
          operation_id: 'invalid-operation',
          status: 'completed',
          started_count: 2,
          resource_id: 'res-a-01',
          period_months: 1,
          amount_minor: 128000,
          currency: 'RUB',
        },
      },
      errorCode: 'PROVIDER_RESULT_MISMATCH',
    },
  ])('TC-REL-012/013: $name causes guarded attention without retries', async ({ response, errorCode }) => {
    provider!.setPostHandler(() => response);
    app = await startReliabilityApp(provider!.baseUrl, {
      PROVIDER_TIMEOUT_MS: 100,
      WORKER_POLL_INTERVAL_MS: 20,
      RENEWAL_JOB_LEASE_MS: 1_000,
    });
    const initiator = await loginUser(app, 'initiator.alpha@example.test');
    const approver = await loginUser(app, 'approver.alpha@example.test');
    const created = await createRequestForResource(prisma, initiator);
    await approveRequest(approver, created);
    await waitForValue(
      async () => {
        const stored = await prisma.renewalRequest.findUnique({ where: { id: created.id } });
        return stored?.status === RenewalRequestStatus.NEEDS_ATTENTION ? stored : null;
      },
      { description: `${errorCode} attention` },
    );
    expect(provider!.postCalls).toHaveLength(1);
    expect(provider!.getCalls).toHaveLength(0);
    expect(
      await prisma.renewalJob.findUniqueOrThrow({ where: { requestId: created.id } }),
    ).toMatchObject({
      status: RenewalJobStatus.WAITING_MANUAL,
      attemptsInCycle: 1,
      totalPostAttempts: 1,
      lastErrorCode: errorCode,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(
      await prisma.renewalRequest.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({ providerOperationId: null, completedAt: null });
    expect(
      (await prisma.resource.findUniqueOrThrow({ where: { id: created.resourceId } })).expiresOn
        .toISOString()
        .slice(0, 10),
    ).toBe('2027-03-01');
  });

  it('TC-REL-014: resource conflict commits attention and no success fields', async () => {
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    provider!.setPostHandler(async (call) => {
      await providerGate;
      return completedProviderResponse(call, 'conflicting-resource-operation');
    });
    app = await startReliabilityApp(provider!.baseUrl, {
      PROVIDER_TIMEOUT_MS: 1_000,
      WORKER_POLL_INTERVAL_MS: 20,
      RENEWAL_JOB_LEASE_MS: 2_000,
    });
    const initiator = await loginUser(app, 'initiator.alpha@example.test');
    const approver = await loginUser(app, 'approver.alpha@example.test');
    const created = await createRequestForResource(prisma, initiator);
    await approveRequest(approver, created);
    await waitForValue(async () => (provider!.postCalls.length === 1 ? true : null));
    await prisma.resource.update({
      where: { id: created.resourceId },
      data: { expiresOn: new Date('2027-03-02T00:00:00.000Z') },
    });
    releaseProvider();
    await waitForValue(async () => {
      const stored = await prisma.renewalRequest.findUnique({ where: { id: created.id } });
      return stored?.status === RenewalRequestStatus.NEEDS_ATTENTION ? stored : null;
    });
    expect(
      await prisma.renewalRequest.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({ providerOperationId: null, completedAt: null });
    expect(
      await prisma.renewalJob.findUniqueOrThrow({ where: { requestId: created.id } }),
    ).toMatchObject({
      status: RenewalJobStatus.WAITING_MANUAL,
      lastErrorCode: 'RESOURCE_CHANGED_BEFORE_FINALIZE',
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(
      (await prisma.resource.findUniqueOrThrow({ where: { id: created.resourceId } })).expiresOn
        .toISOString()
        .slice(0, 10),
    ).toBe('2027-03-02');
    expect(
      await prisma.renewalRequestEvent.count({
        where: {
          requestId: created.id,
          toStatus: RenewalRequestStatus.NEEDS_ATTENTION,
          reasonCode: 'RESOURCE_CHANGED_BEFORE_FINALIZE',
        },
      }),
    ).toBe(1);
  });

  it('Duplicate provider operation IDs produce guarded attention instead of endless reconciliation', async () => {
    provider!.setPostHandler((call) => completedProviderResponse(call, 'shared-provider-operation'));
    app = await startReliabilityApp(provider!.baseUrl, {
      PROVIDER_TIMEOUT_MS: 100,
      WORKER_POLL_INTERVAL_MS: 20,
      RENEWAL_JOB_LEASE_MS: 1_000,
    });
    const initiator = await loginUser(app, 'initiator.alpha@example.test');
    const approver = await loginUser(app, 'approver.alpha@example.test');
    const first = await createRequestForResource(prisma, initiator, 'res-a-01');
    const second = await createRequestForResource(prisma, initiator, 'res-a-02');
    await approveRequest(approver, first);
    await approveRequest(approver, second);

    const requests = await waitForValue(
      async () => {
        const stored = await prisma.renewalRequest.findMany({
          where: { id: { in: [first.id, second.id] } },
        });
        const statuses = stored.map((request) => request.status).sort();
        return statuses.join(',') ===
          [RenewalRequestStatus.COMPLETED, RenewalRequestStatus.NEEDS_ATTENTION].sort().join(',')
          ? stored
          : null;
      },
      { description: 'one completion and one duplicate-operation attention' },
    );
    const completed = requests.find(
      (request) => request.status === RenewalRequestStatus.COMPLETED,
    );
    const attention = requests.find(
      (request) => request.status === RenewalRequestStatus.NEEDS_ATTENTION,
    );
    if (!completed || !attention) {
      throw new Error('Expected one completed and one attention request');
    }
    expect(completed.providerOperationId).toBe('shared-provider-operation');
    expect(attention.providerOperationId).toBeNull();
    expect(attention.completedAt).toBeNull();
    expect(
      await prisma.renewalJob.findUniqueOrThrow({ where: { requestId: attention.id } }),
    ).toMatchObject({
      status: RenewalJobStatus.WAITING_MANUAL,
      lastErrorCode: 'PROVIDER_OPERATION_CONFLICT',
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    const completedResource = await prisma.resource.findUniqueOrThrow({
      where: { id: completed.resourceId },
    });
    const attentionResource = await prisma.resource.findUniqueOrThrow({
      where: { id: attention.resourceId },
    });
    expect(completedResource.expiresOn.toISOString().slice(0, 10)).toBe(
      completed.newExpiry.toISOString().slice(0, 10),
    );
    expect(attentionResource.expiresOn.toISOString().slice(0, 10)).toBe(
      attention.oldExpiry.toISOString().slice(0, 10),
    );
    expect(provider!.postCalls).toHaveLength(2);
    expect(provider!.getCalls).toHaveLength(0);
    await expect(app.get(JobsService).claim('no-duplicate-reconcile', 1_000)).resolves.toBeNull();
  });

  it('TC-REL-015/018: expired lease uses RECONCILE and old fencing versions cannot write', async () => {
    app = await startReliabilityApp(provider!.baseUrl, { WORKER_ENABLED: false });
    const initiator = await loginUser(app, 'initiator.alpha@example.test');
    const approver = await loginUser(app, 'approver.alpha@example.test');
    const created = await createRequestForResource(prisma, initiator);
    await approveRequest(approver, created);
    const jobs = app.get(JobsService);
    const execution = app.get(RenewalExecutionService);
    const first = await jobs.claim('first-worker', 1_000);
    if (!first) {
      throw new Error('First claim was not acquired');
    }
    expect(first).toMatchObject({
      action: RenewalJobAction.POST,
      attemptsInCycle: 1,
      totalPostAttempts: 1,
      executionVersion: 1n,
    });
    await expect(jobs.claim('second-worker', 1_000)).resolves.toBeNull();
    await prisma.$executeRaw(Prisma.sql`
      UPDATE renewal_jobs
      SET lease_expires_at = now() - INTERVAL '1 second'
      WHERE id = ${first.jobId}::uuid
    `);
    const second = await jobs.claim('second-worker', 1_000);
    if (!second) {
      throw new Error('Expired lease was not recovered');
    }
    expect(second).toMatchObject({
      action: RenewalJobAction.RECONCILE,
      attemptsInCycle: 1,
      totalPostAttempts: 1,
      executionVersion: 2n,
    });
    await expect(
      jobs.reschedule(first, RenewalJobAction.POST, 0, 'STALE_OWNER'),
    ).resolves.toBe('stale');
    await expect(execution.attention(first, 'PROVIDER_UNCERTAIN')).resolves.toBe('stale');
    await expect(
      execution.finalize(first, {
        operationId: 'stale-provider-operation',
        status: 'completed',
        startedCount: 1,
        resourceId: 'res-a-01',
        periodMonths: 1,
        amountMinor: 128000,
        currency: 'RUB',
      }),
    ).resolves.toBe('stale');
    expect(
      await prisma.renewalJob.findUniqueOrThrow({ where: { id: first.jobId } }),
    ).toMatchObject({
      status: RenewalJobStatus.RUNNING,
      executionVersion: 2n,
      attemptsInCycle: 1,
      totalPostAttempts: 1,
      lastErrorCode: null,
    });
    await expect(
      jobs.reschedule(second, RenewalJobAction.POST, 0, 'PROVIDER_NOT_FOUND'),
    ).resolves.toBe('applied');
    expect(
      await prisma.renewalJob.findUniqueOrThrow({ where: { id: first.jobId } }),
    ).toMatchObject({
      status: RenewalJobStatus.PENDING,
      nextAction: RenewalJobAction.POST,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(provider!.postCalls).toHaveLength(0);
  });

  it('TC-REL-016: concurrent claims have one current owner', async () => {
    app = await startReliabilityApp(provider!.baseUrl, { WORKER_ENABLED: false });
    const initiator = await loginUser(app, 'initiator.alpha@example.test');
    const approver = await loginUser(app, 'approver.alpha@example.test');
    const created = await createRequestForResource(prisma, initiator);
    await approveRequest(approver, created);
    const jobs = app.get(JobsService);
    const claims = await Promise.all([
      jobs.claim('concurrent-worker-a', 1_000),
      jobs.claim('concurrent-worker-b', 1_000),
    ]);
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    const job = await prisma.renewalJob.findUniqueOrThrow({ where: { requestId: created.id } });
    expect(job.executionVersion).toBe(1n);
    expect(job.totalPostAttempts).toBe(1);
    expect(job.leaseOwner).toMatch(/^concurrent-worker-/);
    expect(provider!.postCalls).toHaveLength(0);
  });
});
