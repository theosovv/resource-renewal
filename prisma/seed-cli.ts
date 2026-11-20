import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedDatabase } from './seed.js';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedDatabase(prisma);
    console.log('Seed completed: 2 workspaces, 4 users/memberships, 3 resources.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('Seed failed. Check DATABASE_URL and applied migrations.');
  process.exitCode = 1;
});
