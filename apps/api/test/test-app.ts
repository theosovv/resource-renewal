import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { expect } from 'vitest';
import type { components } from '@resource-renewal/contracts';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import {
  validateEnvironment,
  type AppEnvironment,
} from '../src/config/environment.js';
import { WorkspaceAccessProbeController } from './workspace-access-probe.controller.js';
import { TEST_WEB_ORIGIN } from './test-security.constants.js';

export const WEB_ORIGIN = TEST_WEB_ORIGIN;

export const seedPasswords = {
  'initiator.alpha@example.test': 'AlphaInitiator!2027',
  'approver.alpha@example.test': 'AlphaApprover!2027',
  'initiator.beta@example.test': 'BetaInitiator!2027',
  'universal.alpha@example.test': 'AlphaUniversal!2027',
} as const;

export type SeedEmail = keyof typeof seedPasswords;
export type TestAgent = ReturnType<typeof request.agent>;
type LoginResponse = components['schemas']['LoginResponse'];

export interface LoginFixture {
  agent: TestAgent;
  csrfToken: string;
  user: LoginResponse['user'];
  cookiePair: string;
  setCookie: string;
}

export async function createTestApp(
  configOverrides: Partial<AppEnvironment> = {},
): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: [WorkspaceAccessProbeController],
  });
  if (Object.keys(configOverrides).length > 0) {
    const validated = validateEnvironment({ ...process.env, ...configOverrides });
    builder = builder.overrideProvider(ConfigService).useValue(new ConfigService(validated));
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApplication(app);
  await app.init();
  return app;
}

export async function login(app: INestApplication, email: SeedEmail): Promise<LoginFixture> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent
    .post('/api/v1/auth/login')
    .set('Origin', WEB_ORIGIN)
    .send({ email, password: seedPasswords[email] })
    .expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const setCookie = response.headers['set-cookie']?.[0];
  const cookiePair = setCookie?.split(';')[0];
  const body = response.body as LoginResponse;
  if (!setCookie || !cookiePair) {
    throw new Error('Login did not set a session cookie');
  }
  return {
    agent,
    csrfToken: body.csrfToken,
    user: body.user,
    cookiePair,
    setCookie,
  };
}
