import { PrismaClient } from '@prisma/client';
import { verify } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../../prisma/seed.js';
import { seedPasswords } from './test-app.js';

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizedIndexDefinition(value: string): string {
  return normalized(value).replace(/ ON [^ ]+\./, ' ON <schema>.');
}

describe('M1 migrations and repeatable seed (real PostgreSQL)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for database E2E tests');
    }
    prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates the specified seed fixture with Argon2id, DATE and BIGINT mappings', async () => {
    expect(await prisma.workspace.count()).toBe(2);
    expect(await prisma.user.count()).toBe(4);
    expect(await prisma.workspaceMembership.count()).toBe(4);
    expect(await prisma.resource.count()).toBe(3);
    expect(await prisma.renewalRequest.count()).toBe(0);
    expect(await prisma.renewalJob.count()).toBe(0);
    expect(await prisma.renewalRequestEvent.count()).toBe(0);

    const resources = await prisma.resource.findMany({ orderBy: { externalId: 'asc' } });
    expect(
      resources.map((resource) => ({
        externalId: resource.externalId,
        name: resource.name,
        expiresOn: resource.expiresOn.toISOString().slice(0, 10),
        amountMinor: resource.amountMinor,
        currency: resource.currency,
      })),
    ).toEqual([
      {
        externalId: 'res-a-01',
        name: 'Хранилище A',
        expiresOn: '2027-03-01',
        amountMinor: 128_000n,
        currency: 'RUB',
      },
      {
        externalId: 'res-a-02',
        name: 'Сервис B',
        expiresOn: '2027-05-20',
        amountMinor: 250_000n,
        currency: 'RUB',
      },
      {
        externalId: 'res-b-01',
        name: 'Сервис C',
        expiresOn: '2027-06-01',
        amountMinor: 150_000n,
        currency: 'RUB',
      },
    ]);

    const universal = await prisma.user.findUniqueOrThrow({
      where: { email: 'universal.alpha@example.test' },
      include: { memberships: true },
    });
    expect(universal.passwordHash).toMatch(/^\$argon2id\$/);
    expect(universal.passwordHash).not.toContain('AlphaUniversal!2027');
    expect(
      await verify(
        universal.passwordHash,
        seedPasswords['universal.alpha@example.test'],
      ),
    ).toBe(true);
    expect(universal.memberships).toHaveLength(1);
    expect(universal.memberships[0]).toMatchObject({ canInitiate: true, canApprove: true });
  });

  it('does not duplicate or roll back business and authorization state on repeated seed', async () => {
    const resource = await prisma.resource.findUniqueOrThrow({ where: { externalId: 'res-a-01' } });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'universal.alpha@example.test' },
      include: { memberships: true },
    });
    const membership = user.memberships[0];
    if (!membership) {
      throw new Error('Seed membership is missing');
    }

    await prisma.resource.update({
      where: { id: resource.id },
      data: { expiresOn: utcDate('2028-01-15'), amountMinor: 333_000n },
    });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await prisma.workspaceMembership.update({
      where: {
        workspaceId_userId: { workspaceId: membership.workspaceId, userId: user.id },
      },
      data: { canInitiate: false, canApprove: true },
    });
    const renewal = await prisma.renewalRequest.create({
      data: {
        workspaceId: resource.workspaceId,
        resourceId: resource.id,
        createdBy: user.id,
        oldExpiry: utcDate('2027-03-01'),
        newExpiry: utcDate('2027-03-31'),
        amountMinor: 128_000n,
        currency: 'RUB',
        operationKey: 'seed-preservation-operation',
      },
    });

    await seedDatabase(prisma);
    await seedDatabase(prisma);

    expect(await prisma.workspace.count()).toBe(2);
    expect(await prisma.user.count()).toBe(4);
    expect(await prisma.workspaceMembership.count()).toBe(4);
    expect(await prisma.resource.count()).toBe(3);
    expect(await prisma.renewalRequest.count()).toBe(1);
    expect(await prisma.resource.findUniqueOrThrow({ where: { id: resource.id } })).toMatchObject({
      expiresOn: utcDate('2028-01-15'),
      amountMinor: 333_000n,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isActive).toBe(false);
    expect(
      (
        await prisma.workspaceMembership.findUniqueOrThrow({
          where: {
            workspaceId_userId: { workspaceId: membership.workspaceId, userId: user.id },
          },
        })
      ).canInitiate,
    ).toBe(false);
    expect(await prisma.renewalRequest.findUnique({ where: { id: renewal.id } })).not.toBeNull();
  });

  it('enforces one active request per resource while retaining terminal history', async () => {
    const resource = await prisma.resource.findUniqueOrThrow({ where: { externalId: 'res-a-01' } });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'initiator.alpha@example.test' },
    });
    const base = {
      workspaceId: resource.workspaceId,
      resourceId: resource.id,
      createdBy: user.id,
      oldExpiry: utcDate('2027-03-01'),
      newExpiry: utcDate('2027-03-31'),
      amountMinor: 128_000n,
      currency: 'RUB',
    };
    await prisma.renewalRequest.create({
      data: { ...base, operationKey: 'database-active-request' },
    });
    await prisma.renewalRequest.create({
      data: { ...base, operationKey: 'database-rejected-request', status: 'REJECTED' },
    });
    await prisma.renewalRequest.create({
      data: {
        ...base,
        operationKey: 'database-completed-request',
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    await expect(
      prisma.renewalRequest.create({
        data: { ...base, operationKey: 'database-processing-request', status: 'PROCESSING' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.renewalRequest.create({
        data: {
          ...base,
          operationKey: 'database-attention-request',
          status: 'NEEDS_ATTENTION',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      await prisma.renewalRequest.count({
        where: {
          resourceId: resource.id,
          status: { in: ['PENDING_APPROVAL', 'PROCESSING', 'NEEDS_ATTENTION'] },
        },
      }),
    ).toBe(1);
    expect(await prisma.renewalRequest.count({ where: { status: 'REJECTED' } })).toBe(1);
    expect(await prisma.renewalRequest.count({ where: { status: 'COMPLETED' } })).toBe(1);
  });

  it('verifies exact partial indexes, CHECK, UNIQUE and FK definitions', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = CURRENT_SCHEMA()
    `;
    const expectedIndexes: Record<string, string> = {
      auth_sessions_absolute_expiry_idx:
        'CREATE INDEX auth_sessions_absolute_expiry_idx ON <schema>.auth_sessions USING btree (absolute_expires_at)',
      auth_sessions_user_idx:
        'CREATE INDEX auth_sessions_user_idx ON <schema>.auth_sessions USING btree (user_id)',
      renewal_jobs_due_idx:
        "CREATE INDEX renewal_jobs_due_idx ON <schema>.renewal_jobs USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['PENDING'::renewal_job_status, 'RUNNING'::renewal_job_status]))",
      renewal_request_events_request_created_idx:
        'CREATE INDEX renewal_request_events_request_created_idx ON <schema>.renewal_request_events USING btree (request_id, created_at)',
      renewal_requests_one_active_per_resource:
        "CREATE UNIQUE INDEX renewal_requests_one_active_per_resource ON <schema>.renewal_requests USING btree (resource_id) WHERE (status = ANY (ARRAY['PENDING_APPROVAL'::renewal_request_status, 'PROCESSING'::renewal_request_status, 'NEEDS_ATTENTION'::renewal_request_status]))",
      renewal_requests_resource_created_idx:
        'CREATE INDEX renewal_requests_resource_created_idx ON <schema>.renewal_requests USING btree (resource_id, created_at DESC)',
      renewal_requests_workspace_status_created_idx:
        'CREATE INDEX renewal_requests_workspace_status_created_idx ON <schema>.renewal_requests USING btree (workspace_id, status, created_at DESC)',
    };
    for (const [name, expected] of Object.entries(expectedIndexes)) {
      const actual = indexes.find((index) => index.indexname === name);
      if (!actual) {
        throw new Error(`Missing index ${name}`);
      }
      expect(normalizedIndexDefinition(actual.indexdef)).toBe(normalized(expected));
    }

    const constraints = await prisma.$queryRaw<
      Array<{ conname: string; definition: string }>
    >`
      SELECT
        pg_constraint_row.conname,
        pg_get_constraintdef(pg_constraint_row.oid) AS definition
      FROM pg_constraint AS pg_constraint_row
      JOIN pg_namespace AS namespace ON namespace.oid = pg_constraint_row.connamespace
      WHERE namespace.nspname = CURRENT_SCHEMA()
    `;
    const actualDefinitions = new Map(
      constraints.map((constraint) => [constraint.conname, normalized(constraint.definition)]),
    );
    const expectedDefinitions: Record<string, string> = {
      auth_sessions_absolute_expiry: 'CHECK ((absolute_expires_at > created_at))',
      auth_sessions_idle_expiry: 'CHECK ((idle_expires_at > last_seen_at))',
      auth_sessions_token_hash_format: "CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))",
      auth_sessions_token_hash_key: 'UNIQUE (token_hash)',
      auth_sessions_user_fk: 'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT',
      renewal_jobs_attempts_in_cycle_check:
        'CHECK (((attempts_in_cycle >= 0) AND (attempts_in_cycle <= 3)))',
      renewal_jobs_execution_version_check: 'CHECK ((execution_version >= 0))',
      renewal_jobs_lease_consistency:
        'CHECK ((((lease_owner IS NULL) AND (lease_expires_at IS NULL)) OR ((lease_owner IS NOT NULL) AND (lease_expires_at IS NOT NULL))))',
      renewal_jobs_request_fk:
        'FOREIGN KEY (request_id) REFERENCES renewal_requests(id) ON DELETE RESTRICT',
      renewal_jobs_request_key: 'UNIQUE (request_id)',
      renewal_jobs_total_post_attempts_check: 'CHECK ((total_post_attempts >= 0))',
      renewal_request_events_actor_consistency:
        "CHECK ((((actor_type = 'USER'::renewal_event_actor_type) AND (actor_user_id IS NOT NULL)) OR ((actor_type = 'SYSTEM'::renewal_event_actor_type) AND (actor_user_id IS NULL))))",
      renewal_request_events_actor_fk:
        'FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT',
      renewal_request_events_creation_consistency:
        "CHECK (((from_status IS NOT NULL) OR (to_status = 'PENDING_APPROVAL'::renewal_request_status)))",
      renewal_request_events_request_fk:
        'FOREIGN KEY (request_id) REFERENCES renewal_requests(id) ON DELETE RESTRICT',
      renewal_requests_amount_minor_check: 'CHECK ((amount_minor >= 0))',
      renewal_requests_creator_fk:
        'FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT',
      renewal_requests_currency_check: "CHECK ((currency = 'RUB'::bpchar))",
      renewal_requests_decision_user_fk:
        'FOREIGN KEY (decision_by) REFERENCES users(id) ON DELETE RESTRICT',
      renewal_requests_no_self_decision:
        'CHECK (((decision_by IS NULL) OR (decision_by <> created_by)))',
      renewal_requests_operation_key_key: 'UNIQUE (operation_key)',
      renewal_requests_period_months_check: 'CHECK ((period_months = 1))',
      renewal_requests_provider_operation_key: 'UNIQUE (provider_operation_id)',
      renewal_requests_resource_workspace_fk:
        'FOREIGN KEY (resource_id, workspace_id) REFERENCES resources(id, workspace_id) ON DELETE RESTRICT',
      renewal_requests_thirty_days: 'CHECK ((new_expiry = (old_expiry + 30)))',
      renewal_requests_workspace_fk:
        'FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT',
      resources_amount_minor_check: 'CHECK ((amount_minor >= 0))',
      resources_currency_check: "CHECK ((currency = 'RUB'::bpchar))",
      resources_external_id_key: 'UNIQUE (external_id)',
      resources_id_workspace_key: 'UNIQUE (id, workspace_id)',
      resources_name_check: 'CHECK ((length(TRIM(BOTH FROM name)) > 0))',
      resources_workspace_fk:
        'FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT',
      users_display_name_check: 'CHECK ((length(TRIM(BOTH FROM display_name)) > 0))',
      users_email_key: 'UNIQUE (email)',
      workspace_memberships_at_least_one_role: 'CHECK ((can_initiate OR can_approve))',
      workspace_memberships_user_fk:
        'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT',
      workspace_memberships_workspace_fk:
        'FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT',
      workspaces_code_key: 'UNIQUE (code)',
      workspaces_name_check: 'CHECK ((length(TRIM(BOTH FROM name)) > 0))',
    };
    for (const [name, expected] of Object.entries(expectedDefinitions)) {
      expect(actualDefinitions.get(name), name).toBe(normalized(expected));
    }
  });
});
