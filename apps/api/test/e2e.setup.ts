import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { seedDatabase } from '../../../prisma/seed.js';
import {
  TEST_CSRF_SECRET,
  TEST_SESSION_ABSOLUTE_TTL_SECONDS,
  TEST_SESSION_IDLE_TTL_SECONDS,
  TEST_WEB_ORIGIN,
} from './test-security.constants.js';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadDotenv({ path: join(projectRoot, '.env'), quiet: true });

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL is required for API E2E tests');
}
process.env.COOKIE_SECURE = 'false';
process.env.WEB_ORIGIN = TEST_WEB_ORIGIN;
process.env.CSRF_SECRET = TEST_CSRF_SECRET;
process.env.SESSION_IDLE_TTL_SECONDS = TEST_SESSION_IDLE_TTL_SECONDS;
process.env.SESSION_ABSOLUTE_TTL_SECONDS = TEST_SESSION_ABSOLUTE_TTL_SECONDS;

const schemaName = `rr_test_${randomUUID().replaceAll('-', '')}`;
const testDatabaseUrl = new URL(baseDatabaseUrl);
testDatabaseUrl.searchParams.set('schema', schemaName);
process.env.DATABASE_URL = testDatabaseUrl.toString();

const adminPrisma = new PrismaClient({
  datasources: { db: { url: baseDatabaseUrl } },
});
const testPrisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl.toString() } },
});

beforeAll(async () => {
  await adminPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');
  const migration = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--schema', join(projectRoot, 'prisma/schema.prisma')],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      timeout: 30_000,
    },
  );
  if (migration.error || migration.status !== 0) {
    throw new Error('Could not migrate the isolated E2E schema');
  }
});

beforeEach(async () => {
  await testPrisma.$executeRaw`
    TRUNCATE TABLE
      renewal_request_events,
      renewal_jobs,
      renewal_requests,
      auth_sessions,
      resources,
      workspace_memberships,
      users,
      workspaces
    RESTART IDENTITY CASCADE
  `;
  await seedDatabase(testPrisma);
});

afterAll(async () => {
  await testPrisma.$disconnect();
  await adminPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPrisma.$disconnect();
});
