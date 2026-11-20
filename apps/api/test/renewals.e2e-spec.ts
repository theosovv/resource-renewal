import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { RenewalJobAction, RenewalJobStatus, RenewalRequestStatus } from '@prisma/client';
import type { components } from '@resource-renewal/contracts';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  providerOperationCount,
  providerOperationStatus,
  startProviderSimulator,
  stopProviderSimulator,
} from './provider-simulator.js';
import { createTestApp, login, WEB_ORIGIN, type LoginFixture } from './test-app.js';

type RenewalRequestResponse = components['schemas']['RenewalRequest'];
type RenewalRequestDetailResponse = components['schemas']['RenewalRequestDetail'];

function expectProblem(body: unknown, status: number, code: string): void {
  expect(body).toMatchObject({ status, code });
  expect((body as { message?: unknown }).message).toEqual(expect.any(String));
}

function mutation(
  fixture: LoginFixture,
  action: 'post',
  path: string,
): request.Test {
  return fixture.agent[action](path).set('Origin', WEB_ORIGIN).set('X-CSRF-Token', fixture.csrfToken);
}

function createResponse(
  fixture: LoginFixture,
  workspaceId: string,
  resourceId: string,
): request.Test {
  return mutation(fixture, 'post', `/api/v1/workspaces/${workspaceId}/requests`).send({ resourceId });
}

async function createPending(
  prisma: PrismaService,
  fixture: LoginFixture,
  externalId: string,
): Promise<RenewalRequestResponse> {
  const resource = await prisma.resource.findUniqueOrThrow({ where: { externalId } });
  const response = await createResponse(fixture, resource.workspaceId, resource.id).expect(201);
  return response.body as RenewalRequestResponse;
}

function approve(fixture: LoginFixture, requestId: string): request.Test {
  const workspaceId = fixture.user.memberships[0]?.workspaceId;
  if (!workspaceId) {
    throw new Error('Approver workspace is missing');
  }
  return mutation(
    fixture,
    'post',
    `/api/v1/workspaces/${workspaceId}/requests/${requestId}/approve`,
  );
}

function reject(fixture: LoginFixture, requestId: string): request.Test {
  const workspaceId = fixture.user.memberships[0]?.workspaceId;
  if (!workspaceId) {
    throw new Error('Approver workspace is missing');
  }
  return mutation(
    fixture,
    'post',
    `/api/v1/workspaces/${workspaceId}/requests/${requestId}/reject`,
  );
}

describe('M2 resources and renewal transitions (HTTP + real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let providerProcess: ChildProcess | null;

  beforeAll(async () => {
    providerProcess = await startProviderSimulator();
  });

  afterAll(() => {
    stopProviderSimulator(providerProcess);
  });

  beforeEach(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('T02-01: resource list/detail use date-only/minor units and active request links', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const alpha = initiator.user.memberships[0];
    if (!alpha) {
      throw new Error('Alpha membership is missing');
    }

    const list = await initiator.agent
      .get(`/api/v1/workspaces/${alpha.workspaceId}/resources`)
      .expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items[0]).toEqual({
      id: expect.any(String),
      workspaceId: alpha.workspaceId,
      externalId: 'res-a-01',
      name: 'Хранилище A',
      expiresOn: '2027-03-01',
      amountMinor: 128000,
      currency: 'RUB',
      activeRequestId: null,
    });

    const created = await createPending(prisma, initiator, 'res-a-01');
    const detail = await initiator.agent
      .get(`/api/v1/workspaces/${alpha.workspaceId}/resources/${created.resourceId}`)
      .expect(200);
    expect(detail.body.activeRequestId).toBe(created.id);
    expect(detail.body.expiresOn).toBe('2027-03-01');

    const unauthenticated = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${alpha.workspaceId}/resources`)
      .expect(401);
    expectProblem(unauthenticated.body, 401, 'UNAUTHORIZED');
  });

  it('M2 validation: malformed UUIDs return 400 and unknown scoped objects return 404', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const workspaceId = initiator.user.memberships[0]?.workspaceId;
    if (!workspaceId) {
      throw new Error('Alpha membership is missing');
    }
    const uppercaseWorkspace = await initiator.agent
      .get(`/api/v1/workspaces/${workspaceId.toUpperCase()}/resources`)
      .expect(200);
    expect(uppercaseWorkspace.body.items).toHaveLength(2);
    const malformedWorkspace = await initiator.agent
      .get('/api/v1/workspaces/not-a-uuid/resources')
      .expect(400);
    expectProblem(malformedWorkspace.body, 400, 'VALIDATION_ERROR');
    const malformedResource = await initiator.agent
      .get(`/api/v1/workspaces/${workspaceId}/resources/not-a-uuid`)
      .expect(400);
    expectProblem(malformedResource.body, 400, 'VALIDATION_ERROR');
    const missingResource = await initiator.agent
      .get(`/api/v1/workspaces/${workspaceId}/resources/${randomUUID()}`)
      .expect(404);
    expectProblem(missingResource.body, 404, 'RESOURCE_NOT_FOUND');
    const missingRequest = await initiator.agent
      .get(`/api/v1/workspaces/${workspaceId}/requests/${randomUUID()}`)
      .expect(404);
    expectProblem(missingRequest.body, 404, 'REQUEST_NOT_FOUND');
  });

  it('TC-REQ-001/TC-DATA-001/003: create fixes the snapshot and creation history', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const created = await createPending(prisma, initiator, 'res-a-01');

    expect(created).toMatchObject({
      workspaceId: initiator.user.memberships[0]?.workspaceId,
      createdBy: initiator.user.id,
      decisionBy: null,
      status: 'PENDING_APPROVAL',
      snapshot: {
        oldExpiry: '2027-03-01',
        newExpiry: '2027-03-31',
        amountMinor: 128000,
        currency: 'RUB',
        periodMonths: 1,
      },
      providerOperationId: null,
      execution: null,
      decidedAt: null,
      completedAt: null,
    });
    expect(created.operationKey).toMatch(/^[0-9a-f-]{36}$/);

    const resource = await prisma.resource.findUniqueOrThrow({ where: { id: created.resourceId } });
    expect(resource.expiresOn.toISOString().slice(0, 10)).toBe('2027-03-01');
    const stored = await prisma.renewalRequest.findUniqueOrThrow({
      where: { id: created.id },
      include: { events: { include: { actorUser: { select: { displayName: true } } } } },
    });
    expect(stored.amountMinor).toBe(128000n);
    expect(stored.createdBy).toBe(initiator.user.id);
    expect(stored.events).toHaveLength(1);
    expect(stored.events[0]).toMatchObject({
      actorType: 'USER',
      actorUserId: initiator.user.id,
      fromStatus: null,
      toStatus: 'PENDING_APPROVAL',
    });

    const detail = await initiator.agent
      .get(`/api/v1/workspaces/${created.workspaceId}/requests/${created.id}`)
      .expect(200);
    const body = detail.body as RenewalRequestDetailResponse;
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({
      actorType: 'USER',
      actorUserId: initiator.user.id,
      actorDisplayName: 'Инициатор Alpha',
      fromStatus: null,
      toStatus: 'PENDING_APPROVAL',
      reasonCode: null,
      createdAt: expect.any(String),
    });
    expect(body.resource.activeRequestId).toBe(created.id);
    expect(JSON.stringify(body)).not.toContain(initiator.csrfToken);
    expect(JSON.stringify(body)).not.toContain(initiator.cookiePair.split('=')[1]);
  });

  it('TC-REQ-002: a second sequential active request maps the partial index to 409', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const created = await createPending(prisma, initiator, 'res-a-01');
    const duplicate = await createResponse(initiator, created.workspaceId, created.resourceId).expect(409);
    expectProblem(duplicate.body, 409, 'REQUEST_ALREADY_ACTIVE');
    expect(await prisma.renewalRequest.count({ where: { resourceId: created.resourceId } })).toBe(1);
    expect(await prisma.renewalRequestEvent.count({ where: { requestId: created.id } })).toBe(1);
  });

  it('TC-REQ-003: parallel create requests leave exactly one active request and event', async () => {
    const first = await login(app, 'initiator.alpha@example.test');
    const second = await login(app, 'initiator.alpha@example.test');
    const resource = await prisma.resource.findUniqueOrThrow({ where: { externalId: 'res-a-01' } });
    const responses = await Promise.all([
      createResponse(first, resource.workspaceId, resource.id),
      createResponse(second, resource.workspaceId, resource.id),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const conflict = responses.find((response) => response.status === 409);
    expectProblem(conflict?.body, 409, 'REQUEST_ALREADY_ACTIVE');
    const requests = await prisma.renewalRequest.findMany({
      where: { resourceId: resource.id },
      include: { events: true },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.events).toHaveLength(1);
  });

  it('TC-REQ-004: different resources accept independent active requests', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const first = await createPending(prisma, initiator, 'res-a-01');
    const second = await createPending(prisma, initiator, 'res-a-02');
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('PENDING_APPROVAL');
    expect(await prisma.renewalRequest.count()).toBe(2);
  });

  it('TC-AUTH-004/008: create rejects authority fields and mutations require session-bound CSRF', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const otherSession = await login(app, 'initiator.alpha@example.test');
    const resource = await prisma.resource.findUniqueOrThrow({ where: { externalId: 'res-a-01' } });
    const path = `/api/v1/workspaces/${resource.workspaceId}/requests`;

    const authority = await mutation(initiator, 'post', path)
      .send({ resourceId: resource.id, role: 'APPROVER', userId: randomUUID() })
      .expect(400);
    expectProblem(authority.body, 400, 'VALIDATION_ERROR');
    for (const csrfToken of [undefined, '0'.repeat(64), otherSession.csrfToken]) {
      let pending = initiator.agent.post(path).set('Origin', WEB_ORIGIN);
      if (csrfToken) {
        pending = pending.set('X-CSRF-Token', csrfToken);
      }
      const response = await pending.send({ resourceId: resource.id }).expect(403);
      expectProblem(response.body, 403, 'CSRF_INVALID');
    }
    expect(await prisma.renewalRequest.count()).toBe(0);
  });

  it('TC-AUTHZ-003: an approver-only account cannot create a request', async () => {
    const approver = await login(app, 'approver.alpha@example.test');
    const resource = await prisma.resource.findUniqueOrThrow({ where: { externalId: 'res-a-01' } });
    const response = await createResponse(approver, resource.workspaceId, resource.id).expect(403);
    expectProblem(response.body, 403, 'FORBIDDEN');
    expect(await prisma.renewalRequest.count()).toBe(0);
    expect(await prisma.renewalRequestEvent.count()).toBe(0);
  });

  it('TC-AUTHZ-002: universal cannot approve or reject their own pending request', async () => {
    const universal = await login(app, 'universal.alpha@example.test');
    const created = await createPending(prisma, universal, 'res-a-01');
    const approved = await approve(universal, created.id).expect(403);
    const rejected = await reject(universal, created.id).expect(403);
    expectProblem(approved.body, 403, 'SELF_DECISION_FORBIDDEN');
    expectProblem(rejected.body, 403, 'SELF_DECISION_FORBIDDEN');
    const stored = await prisma.renewalRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.status).toBe(RenewalRequestStatus.PENDING_APPROVAL);
    expect(stored.decisionBy).toBeNull();
    expect(await prisma.renewalJob.count()).toBe(0);
    expect(await prisma.renewalRequestEvent.count({ where: { requestId: created.id } })).toBe(1);
  });

  it('TC-STATE-001/007: reject records the decision and never calls provider or changes resource', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const approver = await login(app, 'approver.alpha@example.test');
    const created = await createPending(prisma, initiator, 'res-a-02');
    const operationsBefore = await providerOperationCount('res-a-02');
    expect(operationsBefore).toBe(0);

    const response = await reject(approver, created.id).expect(200);
    expect(response.body).toMatchObject({
      status: 'REJECTED',
      decisionBy: approver.user.id,
      decidedAt: expect.any(String),
      execution: null,
    });
    const resource = await prisma.resource.findUniqueOrThrow({ where: { id: created.resourceId } });
    expect(resource.expiresOn.toISOString().slice(0, 10)).toBe('2027-05-20');
    expect(await prisma.renewalJob.count()).toBe(0);
    const events = await prisma.renewalRequestEvent.findMany({
      where: { requestId: created.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      actorType: 'USER',
      actorUserId: approver.user.id,
      fromStatus: RenewalRequestStatus.PENDING_APPROVAL,
      toStatus: RenewalRequestStatus.REJECTED,
    });
    expect(await providerOperationCount('res-a-02')).toBe(0);
    expect(await providerOperationStatus(created.operationKey)).toBe(404);
  });

  it('TC-STATE-002: repeated/invalid reject, approve and retry return 409 without mutations', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const approver = await login(app, 'approver.alpha@example.test');
    const created = await createPending(prisma, initiator, 'res-a-01');
    await reject(approver, created.id).expect(200);

    for (const action of ['approve', 'reject', 'retry']) {
      const response = await mutation(
        approver,
        'post',
        `/api/v1/workspaces/${created.workspaceId}/requests/${created.id}/${action}`,
      ).expect(409);
      expectProblem(response.body, 409, 'INVALID_STATE_TRANSITION');
    }
    expect(await prisma.renewalJob.count()).toBe(0);
    expect(await prisma.renewalRequestEvent.count({ where: { requestId: created.id } })).toBe(2);
  });

  it('TC-STATE-005/TC-REL-001: approve atomically creates one durable PENDING/POST job and history', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const approver = await login(app, 'approver.alpha@example.test');
    const created = await createPending(prisma, initiator, 'res-a-01');
    const response = await approve(approver, created.id).expect(200);
    expect(response.body).toMatchObject({
      status: 'PROCESSING',
      decisionBy: approver.user.id,
      execution: {
        status: 'PENDING',
        attemptsInCycle: 0,
        totalPostAttempts: 0,
        lastErrorCode: null,
      },
    });

    const job = await prisma.renewalJob.findUniqueOrThrow({ where: { requestId: created.id } });
    expect(job).toMatchObject({
      status: RenewalJobStatus.PENDING,
      nextAction: RenewalJobAction.POST,
      attemptsInCycle: 0,
      totalPostAttempts: 0,
      executionVersion: 0n,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: null,
    });
    const events = await prisma.renewalRequestEvent.findMany({ where: { requestId: created.id } });
    expect(events).toHaveLength(2);
    expect(events.some((event) => event.toStatus === RenewalRequestStatus.PROCESSING)).toBe(true);

    const repeated = await approve(approver, created.id).expect(409);
    expectProblem(repeated.body, 409, 'INVALID_STATE_TRANSITION');
    expect(await prisma.renewalJob.count()).toBe(1);
    expect(await prisma.renewalRequestEvent.count({ where: { requestId: created.id } })).toBe(2);
  });

  it('TC-STATE-004: two real parallel approvals yield one transition, one job and one 409', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const firstApprover = await login(app, 'approver.alpha@example.test');
    const secondApprover = await login(app, 'approver.alpha@example.test');
    const created = await createPending(prisma, initiator, 'res-a-01');
    const responses = await Promise.all([
      approve(firstApprover, created.id),
      approve(secondApprover, created.id),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expectProblem(
      responses.find((response) => response.status === 409)?.body,
      409,
      'INVALID_STATE_TRANSITION',
    );
    expect(await prisma.renewalJob.count({ where: { requestId: created.id } })).toBe(1);
    expect(
      await prisma.renewalRequestEvent.count({
        where: { requestId: created.id, toStatus: RenewalRequestStatus.PROCESSING },
      }),
    ).toBe(1);
  });

  it.each(['expiry', 'amount', 'currency'] as const)(
    'TC-STATE-003: stale %s blocks approve without job or status change',
    async (field) => {
      const initiator = await login(app, 'initiator.alpha@example.test');
      const approver = await login(app, 'approver.alpha@example.test');
      const created = await createPending(prisma, initiator, 'res-a-01');
      if (field === 'currency') {
        await prisma.$executeRaw`ALTER TABLE resources DROP CONSTRAINT resources_currency_check`;
      }
      try {
        await prisma.resource.update({
          where: { id: created.resourceId },
          data:
            field === 'expiry'
              ? { expiresOn: new Date('2027-03-02T00:00:00.000Z') }
              : field === 'amount'
                ? { amountMinor: 128001n }
                : { currency: 'USD' },
        });
        const response = await approve(approver, created.id).expect(409);
        expectProblem(response.body, 409, 'RESOURCE_SNAPSHOT_MISMATCH');
        const stored = await prisma.renewalRequest.findUniqueOrThrow({ where: { id: created.id } });
        expect(stored.status).toBe(RenewalRequestStatus.PENDING_APPROVAL);
        expect(stored.decisionBy).toBeNull();
        expect(await prisma.renewalJob.count()).toBe(0);
        expect(await prisma.renewalRequestEvent.count({ where: { requestId: created.id } })).toBe(1);
      } finally {
        if (field === 'currency') {
          await prisma.resource.update({
            where: { id: created.resourceId },
            data: { currency: 'RUB' },
          });
          await prisma.$executeRaw`
            ALTER TABLE resources
            ADD CONSTRAINT resources_currency_check CHECK (currency = 'RUB')
          `;
        }
      }
    },
  );

  it('TC-REL-001: a history insert failure rolls back approve and job together', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const approver = await login(app, 'approver.alpha@example.test');
    const created = await createPending(prisma, initiator, 'res-a-01');
    await prisma.$executeRaw`
      CREATE FUNCTION m2_fail_approval_event() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'M2 forced approval history failure';
      END;
      $$
    `;
    await prisma.$executeRaw`
      CREATE TRIGGER m2_fail_approval_event
      BEFORE INSERT ON renewal_request_events
      FOR EACH ROW
      WHEN (NEW.from_status = 'PENDING_APPROVAL' AND NEW.to_status = 'PROCESSING')
      EXECUTE FUNCTION m2_fail_approval_event()
    `;
    try {
      const response = await approve(approver, created.id).expect(500);
      expectProblem(response.body, 500, 'INTERNAL_ERROR');
    } finally {
      await prisma.$executeRaw`DROP TRIGGER m2_fail_approval_event ON renewal_request_events`;
      await prisma.$executeRaw`DROP FUNCTION m2_fail_approval_event()`;
    }
    const stored = await prisma.renewalRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.status).toBe(RenewalRequestStatus.PENDING_APPROVAL);
    expect(stored.decisionBy).toBeNull();
    expect(await prisma.renewalJob.count()).toBe(0);
    expect(await prisma.renewalRequestEvent.count({ where: { requestId: created.id } })).toBe(1);
  });

  it('TC-DATA-005/TC-STATE-006: resource history retains rejected requests and permits a new snapshot', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const approver = await login(app, 'approver.alpha@example.test');
    const rejectedRequest = await createPending(prisma, initiator, 'res-a-01');
    await reject(approver, rejectedRequest.id).expect(200);
    const pendingRequest = await createPending(prisma, initiator, 'res-a-01');
    await createPending(prisma, initiator, 'res-a-02');

    const filtered = await initiator.agent
      .get(`/api/v1/workspaces/${pendingRequest.workspaceId}/requests`)
      .query({ resourceId: pendingRequest.resourceId })
      .expect(200);
    expect(filtered.body.total).toBe(2);
    expect(filtered.body.items.map((item: RenewalRequestResponse) => item.id)).toEqual([
      pendingRequest.id,
      rejectedRequest.id,
    ]);
    const pendingOnly = await initiator.agent
      .get(`/api/v1/workspaces/${pendingRequest.workspaceId}/requests`)
      .query({ resourceId: pendingRequest.resourceId, status: 'PENDING_APPROVAL' })
      .expect(200);
    expect(pendingOnly.body.total).toBe(1);
    expect(pendingOnly.body.items[0].id).toBe(pendingRequest.id);
    const invalid = await initiator.agent
      .get(`/api/v1/workspaces/${pendingRequest.workspaceId}/requests`)
      .query({ status: 'UNKNOWN' })
      .expect(400);
    expectProblem(invalid.body, 400, 'VALIDATION_ERROR');
  });

  it('TC-TENANT-001…004: workspace checks precede object lookup and all queries stay scoped', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const approver = await login(app, 'approver.alpha@example.test');
    const beta = await login(app, 'initiator.beta@example.test');
    const created = await createPending(prisma, initiator, 'res-a-01');
    const alphaWorkspaceId = created.workspaceId;
    const betaWorkspaceId = beta.user.memberships[0]?.workspaceId;
    if (!betaWorkspaceId) {
      throw new Error('Beta membership is missing');
    }

    for (const path of [
      `/api/v1/workspaces/${alphaWorkspaceId}/resources`,
      `/api/v1/workspaces/${alphaWorkspaceId}/resources/${created.resourceId}`,
      `/api/v1/workspaces/${alphaWorkspaceId}/requests`,
      `/api/v1/workspaces/${alphaWorkspaceId}/requests/${created.id}`,
    ]) {
      const response = await beta.agent.get(path).expect(403);
      expectProblem(response.body, 403, 'FORBIDDEN');
      expect(JSON.stringify(response.body)).not.toContain(created.id);
    }
    for (const action of ['approve', 'reject', 'retry']) {
      const response = await mutation(
        beta,
        'post',
        `/api/v1/workspaces/${alphaWorkspaceId}/requests/${created.id}/${action}`,
      ).expect(403);
      expectProblem(response.body, 403, 'FORBIDDEN');
    }
    const crossCreate = await createResponse(beta, alphaWorkspaceId, created.resourceId).expect(403);
    expectProblem(crossCreate.body, 403, 'FORBIDDEN');

    const hiddenResource = await beta.agent
      .get(`/api/v1/workspaces/${betaWorkspaceId}/resources/${created.resourceId}`)
      .expect(404);
    expectProblem(hiddenResource.body, 404, 'RESOURCE_NOT_FOUND');
    const hiddenRequest = await beta.agent
      .get(`/api/v1/workspaces/${betaWorkspaceId}/requests/${created.id}`)
      .expect(404);
    expectProblem(hiddenRequest.body, 404, 'REQUEST_NOT_FOUND');
    const hiddenCreate = await createResponse(beta, betaWorkspaceId, created.resourceId).expect(404);
    expectProblem(hiddenCreate.body, 404, 'RESOURCE_NOT_FOUND');
    const betaList = await beta.agent
      .get(`/api/v1/workspaces/${betaWorkspaceId}/requests`)
      .expect(200);
    expect(betaList.body).toEqual({ items: [], total: 0 });

    const stored = await prisma.renewalRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.status).toBe(RenewalRequestStatus.PENDING_APPROVAL);
    expect(await prisma.renewalRequest.count()).toBe(1);
    expect(await prisma.renewalJob.count()).toBe(0);

    // Keep the approver session exercised so this test covers both viewer roles on Alpha data.
    await approver.agent
      .get(`/api/v1/workspaces/${alphaWorkspaceId}/requests/${created.id}`)
      .expect(200);
  });

  it('TC-AUTHZ-001: initiator cannot approve, reject or retry even inside their workspace', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const created = await createPending(prisma, initiator, 'res-a-01');
    for (const action of ['approve', 'reject', 'retry']) {
      const response = await mutation(
        initiator,
        'post',
        `/api/v1/workspaces/${created.workspaceId}/requests/${created.id}/${action}`,
      ).expect(403);
      expectProblem(response.body, 403, 'FORBIDDEN');
    }
    expect(await prisma.renewalJob.count()).toBe(0);
    expect(await prisma.renewalRequestEvent.count({ where: { requestId: created.id } })).toBe(1);
  });

  it('TC-AUTH-008: approve/reject/retry reject missing CSRF before any business mutation', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const approver = await login(app, 'approver.alpha@example.test');
    const created = await createPending(prisma, initiator, 'res-a-01');
    for (const action of ['approve', 'reject', 'retry']) {
      const response = await approver.agent
        .post(`/api/v1/workspaces/${created.workspaceId}/requests/${created.id}/${action}`)
        .set('Origin', WEB_ORIGIN)
        .expect(403);
      expectProblem(response.body, 403, 'CSRF_INVALID');
    }
    const stored = await prisma.renewalRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.status).toBe(RenewalRequestStatus.PENDING_APPROVAL);
    expect(stored.decisionBy).toBeNull();
    expect(await prisma.renewalJob.count()).toBe(0);
    expect(await prisma.renewalRequestEvent.count({ where: { requestId: created.id } })).toBe(1);
  });

  it('Manual retry preserves key/total attempts and starts a RECONCILE cycle only from attention', async () => {
    const initiator = await login(app, 'initiator.alpha@example.test');
    const approver = await login(app, 'approver.alpha@example.test');
    const created = await createPending(prisma, initiator, 'res-a-01');
    await prisma.renewalRequest.update({
      where: { id: created.id },
      data: {
        status: RenewalRequestStatus.NEEDS_ATTENTION,
        decisionBy: approver.user.id,
        decidedAt: new Date(),
      },
    });
    await prisma.renewalJob.create({
      data: {
        requestId: created.id,
        status: RenewalJobStatus.WAITING_MANUAL,
        nextAction: RenewalJobAction.POST,
        attemptsInCycle: 3,
        totalPostAttempts: 3,
        lastErrorCode: 'PROVIDER_UNCERTAIN',
      },
    });

    const response = await mutation(
      approver,
      'post',
      `/api/v1/workspaces/${created.workspaceId}/requests/${created.id}/retry`,
    ).expect(200);
    expect(response.body).toMatchObject({
      status: 'PROCESSING',
      operationKey: created.operationKey,
      execution: { status: 'PENDING', attemptsInCycle: 0, totalPostAttempts: 3 },
    });
    const job = await prisma.renewalJob.findUniqueOrThrow({ where: { requestId: created.id } });
    expect(job).toMatchObject({
      nextAction: RenewalJobAction.RECONCILE,
      attemptsInCycle: 0,
      totalPostAttempts: 3,
      executionVersion: 0n,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    const duplicateCreate = await createResponse(
      initiator,
      created.workspaceId,
      created.resourceId,
    ).expect(409);
    expectProblem(duplicateCreate.body, 409, 'REQUEST_ALREADY_ACTIVE');
    const repeated = await mutation(
      approver,
      'post',
      `/api/v1/workspaces/${created.workspaceId}/requests/${created.id}/retry`,
    ).expect(409);
    expectProblem(repeated.body, 409, 'INVALID_STATE_TRANSITION');
    expect(await prisma.renewalJob.count()).toBe(1);
    expect(
      await prisma.renewalRequestEvent.count({
        where: {
          requestId: created.id,
          fromStatus: RenewalRequestStatus.NEEDS_ATTENTION,
          toStatus: RenewalRequestStatus.PROCESSING,
          actorUserId: approver.user.id,
        },
      }),
    ).toBe(1);
  });
});
