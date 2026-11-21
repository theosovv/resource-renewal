import type { INestApplication } from '@nestjs/common';
import {
  PrismaClient,
  RenewalEventActorType,
  RenewalJobAction,
  RenewalJobStatus,
  RenewalRequestStatus,
} from '@prisma/client';
import type { ChildProcess } from 'node:child_process';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RenewalExecutionService } from '../src/modules/renewals/renewal-execution.service.js';
import { WEB_ORIGIN } from './test-app.js';
import {
  providerOperation,
  providerOperationCount,
  startProviderSimulator,
  stopProviderSimulator,
} from './provider-simulator.js';
import {
  approveRequest,
  createRequestForResource,
  detailWithCookie,
  loginUser,
  startReliabilityApp,
} from './reliability-helpers.js';
import { waitForValue } from './wait-for-value.js';

const prisma = new PrismaClient();

describe('M3 recovery with the real provider simulator (HTTP + real PostgreSQL)', () => {
  let app: INestApplication | null = null;
  let providerProcess: ChildProcess | null = null;

  beforeEach(async () => {
    providerProcess = await startProviderSimulator();
  });

  afterEach(async () => {
    await app?.close();
    app = null;
    await stopProviderSimulator(providerProcess);
    providerProcess = null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    'TC-REL-002/003/004/005, TC-STATE-006, TC-HIST-001: restart reconciles one operation and finalizes once',
    async () => {
      app = await startReliabilityApp('http://127.0.0.1:8091', {
        RENEWAL_RETRY_DELAY_MS: 5_000,
      });
      const initiator = await loginUser(app, 'initiator.alpha@example.test');
      const approver = await loginUser(app, 'approver.alpha@example.test');
      const created = await createRequestForResource(prisma, initiator);
      await approveRequest(approver, created);

      const uncertainJob = await waitForValue(
        async () => {
          const job = await prisma.renewalJob.findUnique({ where: { requestId: created.id } });
          return job?.status === RenewalJobStatus.PENDING &&
            job.nextAction === RenewalJobAction.RECONCILE &&
            job.totalPostAttempts === 1 &&
            job.leaseOwner === null &&
            job.leaseExpiresAt === null
            ? job
            : null;
        },
        { description: 'persisted RECONCILE delay after the first 503' },
      );
      expect(uncertainJob.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      expect(uncertainJob.lastErrorCode).toBe('PROVIDER_UNCERTAIN');

      // Stop immediately after the persisted uncertain state; no provider assertions may delay shutdown.
      await app.close();
      app = null;

      expect(
        await prisma.renewalRequest.findUniqueOrThrow({ where: { id: created.id } }),
      ).toMatchObject({ status: RenewalRequestStatus.PROCESSING, providerOperationId: null });
      expect(
        (await prisma.resource.findUniqueOrThrow({ where: { id: created.resourceId } })).expiresOn
          .toISOString()
          .slice(0, 10),
      ).toBe('2027-03-01');
      expect(await providerOperationCount('res-a-01')).toBe(1);

      app = await startReliabilityApp('http://127.0.0.1:8091', {
        RENEWAL_RETRY_DELAY_MS: 5_000,
      });
      const completedDetail = await waitForValue(
        async () => {
          const detail = await detailWithCookie(app!, created, initiator.cookiePair);
          return detail.status === RenewalRequestStatus.COMPLETED ? detail : null;
        },
        { description: 'public COMPLETED state after application restart' },
      );
      expect(completedDetail.operationKey).toBe(created.operationKey);
      expect(completedDetail.providerOperationId).toEqual(expect.any(String));
      expect(completedDetail.resource.expiresOn).toBe('2027-03-31');
      expect(completedDetail.history).toHaveLength(3);
      expect(completedDetail.history[2]).toMatchObject({
        actorType: RenewalEventActorType.SYSTEM,
        actorUserId: null,
        actorDisplayName: null,
        fromStatus: RenewalRequestStatus.PROCESSING,
        toStatus: RenewalRequestStatus.COMPLETED,
        reasonCode: null,
      });

      const storedRequest = await prisma.renewalRequest.findUniqueOrThrow({
        where: { id: created.id },
      });
      const storedJob = await prisma.renewalJob.findUniqueOrThrow({
        where: { requestId: created.id },
      });
      expect(storedJob).toMatchObject({
        status: RenewalJobStatus.SUCCEEDED,
        attemptsInCycle: 1,
        totalPostAttempts: 1,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
      });
      expect(storedJob.completedAt).not.toBeNull();
      const operation = await providerOperation(created.operationKey);
      expect(operation).toMatchObject({
        operation_id: storedRequest.providerOperationId,
        status: 'completed',
        started_count: 1,
        resource_id: 'res-a-01',
        period_months: 1,
        amount_minor: 128000,
        currency: 'RUB',
      });
      expect(await providerOperationCount('res-a-01')).toBe(1);

      const execution = app.get(RenewalExecutionService);
      await expect(
        execution.finalize(
          {
            jobId: storedJob.id,
            requestId: storedRequest.id,
            executionVersion: storedJob.executionVersion,
            action: RenewalJobAction.RECONCILE,
            attemptsInCycle: storedJob.attemptsInCycle,
            totalPostAttempts: storedJob.totalPostAttempts,
            operationKey: storedRequest.operationKey,
            payload: {
              resourceId: 'res-a-01',
              periodMonths: storedRequest.periodMonths,
              amountMinor: storedRequest.amountMinor,
              currency: storedRequest.currency,
            },
          },
          {
            operationId: operation.operation_id,
            status: 'completed',
            startedCount: 1,
            resourceId: operation.resource_id,
            periodMonths: operation.period_months,
            amountMinor: operation.amount_minor,
            currency: operation.currency,
          },
        ),
      ).resolves.toBe('noop');
      expect(
        await prisma.renewalRequestEvent.count({
          where: { requestId: created.id, toStatus: RenewalRequestStatus.COMPLETED },
        }),
      ).toBe(1);
      expect(
        (await prisma.resource.findUniqueOrThrow({ where: { id: created.resourceId } })).expiresOn
          .toISOString()
          .slice(0, 10),
      ).toBe('2027-03-31');

      const restartedInitiator = await loginUser(app, 'initiator.alpha@example.test');
      const next = await createRequestForResource(prisma, restartedInitiator);
      expect(next.snapshot).toMatchObject({
        oldExpiry: '2027-03-31',
        newExpiry: '2027-04-30',
        amountMinor: 128000,
        currency: 'RUB',
      });
      expect(next.operationKey).not.toBe(created.operationKey);
      expect(await providerOperationCount('res-a-01')).toBe(1);

      const duplicateWhileNextActive = await restartedInitiator.agent
        .post(`/api/v1/workspaces/${next.workspaceId}/requests`)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', restartedInitiator.csrfToken)
        .send({ resourceId: next.resourceId })
        .expect(409);
      expect(duplicateWhileNextActive.body.code).toBe('REQUEST_ALREADY_ACTIVE');
      await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${created.workspaceId}/resources/${created.resourceId}`)
        .set('Cookie', restartedInitiator.cookiePair)
        .expect(200)
        .expect((response) => {
          expect(response.body.expiresOn).toBe('2027-03-31');
          expect(response.body.activeRequestId).toBe(next.id);
        });
    },
    30_000,
  );
});
