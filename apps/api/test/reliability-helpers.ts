import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { components } from '@resource-renewal/contracts';
import request from 'supertest';
import type { AppEnvironment } from '../src/config/environment.js';
import { createTestApp, login, WEB_ORIGIN, type LoginFixture, type SeedEmail } from './test-app.js';

export type RenewalResponse = components['schemas']['RenewalRequest'];
export type RenewalDetailResponse = components['schemas']['RenewalRequestDetail'];

export function reliabilityWorkerConfig(
  providerBaseUrl: string,
  overrides: Partial<AppEnvironment> = {},
): Partial<AppEnvironment> {
  return {
    PROVIDER_BASE_URL: providerBaseUrl,
    PROVIDER_TIMEOUT_MS: 200,
    WORKER_ENABLED: true,
    WORKER_POLL_INTERVAL_MS: 25,
    RENEWAL_RETRY_DELAY_MS: 1_500,
    RENEWAL_JOB_LEASE_MS: 2_000,
    ...overrides,
  };
}

export async function startReliabilityApp(
  providerBaseUrl: string,
  overrides: Partial<AppEnvironment> = {},
): Promise<INestApplication> {
  return createTestApp(reliabilityWorkerConfig(providerBaseUrl, overrides));
}

export async function loginUser(
  app: INestApplication,
  email: SeedEmail,
): Promise<LoginFixture> {
  return login(app, email);
}

export async function createRequestForResource(
  prisma: PrismaClient,
  actor: LoginFixture,
  externalId = 'res-a-01',
): Promise<RenewalResponse> {
  const workspaceId = actor.user.memberships[0]?.workspaceId;
  if (!workspaceId) {
    throw new Error('Test actor has no workspace');
  }
  const resource = await prisma.resource.findUniqueOrThrow({ where: { externalId } });
  const response = await actor.agent
    .post(`/api/v1/workspaces/${workspaceId}/requests`)
    .set('Origin', WEB_ORIGIN)
    .set('X-CSRF-Token', actor.csrfToken)
    .send({ resourceId: resource.id })
    .expect(201);
  return response.body as RenewalResponse;
}

export function createRequestById(
  actor: LoginFixture,
  workspaceId: string,
  resourceId: string,
) {
  return actor.agent
    .post(`/api/v1/workspaces/${workspaceId}/requests`)
    .set('Origin', WEB_ORIGIN)
    .set('X-CSRF-Token', actor.csrfToken)
    .send({ resourceId });
}

export async function approveRequest(
  actor: LoginFixture,
  renewal: RenewalResponse,
): Promise<RenewalResponse> {
  const response = await actor.agent
    .post(`/api/v1/workspaces/${renewal.workspaceId}/requests/${renewal.id}/approve`)
    .set('Origin', WEB_ORIGIN)
    .set('X-CSRF-Token', actor.csrfToken)
    .expect(200);
  return response.body as RenewalResponse;
}

export function retryRequest(actor: LoginFixture, renewal: RenewalResponse) {
  return actor.agent
    .post(`/api/v1/workspaces/${renewal.workspaceId}/requests/${renewal.id}/retry`)
    .set('Origin', WEB_ORIGIN)
    .set('X-CSRF-Token', actor.csrfToken);
}

export async function detailWithCookie(
  app: INestApplication,
  renewal: RenewalResponse,
  cookiePair: string,
): Promise<RenewalDetailResponse> {
  const response = await request(app.getHttpServer())
    .get(`/api/v1/workspaces/${renewal.workspaceId}/requests/${renewal.id}`)
    .set('Cookie', cookiePair)
    .expect(200);
  return response.body as RenewalDetailResponse;
}
