import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';

describe('GET /api/v1/health (real PostgreSQL)', () => {
  let app: INestApplication | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports ok after a real database round trip', async () => {
    if (!app) {
      throw new Error('Test application was not initialized');
    }

    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect('Content-Type', /application\/json/)
      .expect(({ body }) => {
        expect(body).toEqual({ status: 'ok' });
      });
  });
});
