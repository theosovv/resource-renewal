import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { seedDatabase } from './seed.js';

function databaseNameFromUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!databaseName || databaseName.includes('/')) {
    throw new Error('DATABASE_URL must identify one database');
  }
  return databaseName;
}

async function main(): Promise<void> {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== 'test' && nodeEnv !== 'development') {
    throw new Error('Refusing reset: set NODE_ENV=test or NODE_ENV=development explicitly');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const databaseName = databaseNameFromUrl(databaseUrl);
  if (process.env.CONFIRM_DATABASE_RESET !== databaseName) {
    throw new Error(
      `Refusing reset: set CONFIRM_DATABASE_RESET=${databaseName} to confirm destructive reset`,
    );
  }

  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');
  const result = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'reset', '--force', '--skip-seed'],
    { env: process.env, stdio: 'inherit' },
  );
  if (result.error || result.status !== 0) {
    throw new Error('Prisma migrate reset failed');
  }

  const prisma = new PrismaClient();
  try {
    await seedDatabase(prisma);
    console.log(`Test database ${databaseName} was migrated and seeded.`);
    console.log('Restart provider_simulator.py separately before a fresh acceptance run.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown reset error';
  console.error(message);
  process.exitCode = 1;
});
