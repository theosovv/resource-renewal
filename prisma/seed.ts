import { argon2id, hash } from 'argon2';
import type { PrismaClient } from '@prisma/client';

const seedAccounts = [
  {
    email: 'initiator.alpha@example.test',
    displayName: 'Инициатор Alpha',
    password: 'AlphaInitiator!2027',
    workspaceCode: 'ALPHA',
    canInitiate: true,
    canApprove: false,
  },
  {
    email: 'approver.alpha@example.test',
    displayName: 'Согласующий Alpha',
    password: 'AlphaApprover!2027',
    workspaceCode: 'ALPHA',
    canInitiate: false,
    canApprove: true,
  },
  {
    email: 'initiator.beta@example.test',
    displayName: 'Инициатор Beta',
    password: 'BetaInitiator!2027',
    workspaceCode: 'BETA',
    canInitiate: true,
    canApprove: false,
  },
  {
    email: 'universal.alpha@example.test',
    displayName: 'Универсальный пользователь Alpha',
    password: 'AlphaUniversal!2027',
    workspaceCode: 'ALPHA',
    canInitiate: true,
    canApprove: true,
  },
] as const;

const seedResources = [
  {
    workspaceCode: 'ALPHA',
    externalId: 'res-a-01',
    name: 'Хранилище A',
    expiresOn: '2027-03-01',
    amountMinor: 128_000n,
  },
  {
    workspaceCode: 'ALPHA',
    externalId: 'res-a-02',
    name: 'Сервис B',
    expiresOn: '2027-05-20',
    amountMinor: 250_000n,
  },
  {
    workspaceCode: 'BETA',
    externalId: 'res-b-01',
    name: 'Сервис C',
    expiresOn: '2027-06-01',
    amountMinor: 150_000n,
  },
] as const;

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function seedDatabase(client: PrismaClient): Promise<void> {
  const passwordHashes = new Map<string, string>();
  for (const account of seedAccounts) {
    passwordHashes.set(
      account.email,
      await hash(account.password, {
        type: argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      }),
    );
  }

  await client.$transaction(async (transaction) => {
    const workspaces = new Map<string, string>();
    for (const workspace of [
      { code: 'ALPHA', name: 'Alpha' },
      { code: 'BETA', name: 'Beta' },
    ] as const) {
      const saved = await transaction.workspace.upsert({
        where: { code: workspace.code },
        update: { name: workspace.name },
        create: workspace,
      });
      workspaces.set(saved.code, saved.id);
    }

    for (const account of seedAccounts) {
      const passwordHash = passwordHashes.get(account.email);
      const workspaceId = workspaces.get(account.workspaceCode);
      if (!passwordHash || !workspaceId) {
        throw new Error('Seed account could not be resolved');
      }

      const existingUser = await transaction.user.findUnique({
        where: { email: account.email },
        select: { id: true },
      });
      // Существующие identity/memberships не изменяются: удалённый доступ остаётся отозванным.
      if (existingUser) {
        continue;
      }

      const user = await transaction.user.create({
        data: {
          email: account.email,
          displayName: account.displayName,
          passwordHash,
        },
      });
      await transaction.workspaceMembership.create({
        data: {
          workspaceId,
          userId: user.id,
          canInitiate: account.canInitiate,
          canApprove: account.canApprove,
        },
      });
    }

    for (const resource of seedResources) {
      const workspaceId = workspaces.get(resource.workspaceCode);
      if (!workspaceId) {
        throw new Error('Seed resource workspace could not be resolved');
      }

      await transaction.resource.upsert({
        where: { externalId: resource.externalId },
        // Повторный seed не восстанавливает snapshot или текущий срок после бизнес-операций.
        update: {},
        create: {
          workspaceId,
          externalId: resource.externalId,
          name: resource.name,
          expiresOn: utcDate(resource.expiresOn),
          amountMinor: resource.amountMinor,
          currency: 'RUB',
        },
      });
    }
  });
}
