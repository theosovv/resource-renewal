-- Resource Renewal: эталонная спецификация PostgreSQL schema.
-- Это НЕ Prisma migration. Реализация обязана воспроизвести ограничения
-- через версионированные миграции и сохранить имена constraints/indexes.

CREATE TYPE renewal_request_status AS ENUM (
    'PENDING_APPROVAL',
    'REJECTED',
    'PROCESSING',
    'COMPLETED',
    'NEEDS_ATTENTION'
);

CREATE TYPE renewal_job_status AS ENUM (
    'PENDING',
    'RUNNING',
    'WAITING_MANUAL',
    'SUCCEEDED'
);

CREATE TYPE renewal_job_action AS ENUM (
    'POST',
    'RECONCILE'
);

CREATE TYPE renewal_event_actor_type AS ENUM (
    'USER',
    'SYSTEM'
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL CONSTRAINT users_email_key UNIQUE,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL
        CONSTRAINT auth_sessions_user_fk
        REFERENCES users(id) ON DELETE RESTRICT,
    token_hash CHAR(64) NOT NULL
        CONSTRAINT auth_sessions_token_hash_key UNIQUE
        CONSTRAINT auth_sessions_token_hash_format
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    idle_expires_at TIMESTAMPTZ NOT NULL,
    absolute_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT auth_sessions_absolute_expiry
        CHECK (absolute_expires_at > created_at),
    CONSTRAINT auth_sessions_idle_expiry
        CHECK (idle_expires_at > last_seen_at)
);

CREATE INDEX auth_sessions_user_idx
    ON auth_sessions (user_id);

CREATE INDEX auth_sessions_absolute_expiry_idx
    ON auth_sessions (absolute_expires_at);

CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL CONSTRAINT workspaces_code_key UNIQUE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace_memberships (
    workspace_id UUID NOT NULL
        CONSTRAINT workspace_memberships_workspace_fk
        REFERENCES workspaces(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL
        CONSTRAINT workspace_memberships_user_fk
        REFERENCES users(id) ON DELETE RESTRICT,
    can_initiate BOOLEAN NOT NULL DEFAULT FALSE,
    can_approve BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id),
    CONSTRAINT workspace_memberships_at_least_one_role
        CHECK (can_initiate OR can_approve)
);

CREATE TABLE resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL
        CONSTRAINT resources_workspace_fk
        REFERENCES workspaces(id) ON DELETE RESTRICT,
    external_id TEXT NOT NULL CONSTRAINT resources_external_id_key UNIQUE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    expires_on DATE NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    currency CHAR(3) NOT NULL CHECK (currency = 'RUB'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT resources_id_workspace_key UNIQUE (id, workspace_id)
);

CREATE TABLE renewal_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL
        CONSTRAINT renewal_requests_workspace_fk
        REFERENCES workspaces(id) ON DELETE RESTRICT,
    resource_id UUID NOT NULL,
    created_by UUID NOT NULL
        CONSTRAINT renewal_requests_creator_fk
        REFERENCES users(id) ON DELETE RESTRICT,
    decision_by UUID
        CONSTRAINT renewal_requests_decision_user_fk
        REFERENCES users(id) ON DELETE RESTRICT,
    status renewal_request_status NOT NULL DEFAULT 'PENDING_APPROVAL',
    old_expiry DATE NOT NULL,
    new_expiry DATE NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    currency CHAR(3) NOT NULL CHECK (currency = 'RUB'),
    period_months SMALLINT NOT NULL DEFAULT 1 CHECK (period_months = 1),
    operation_key TEXT NOT NULL
        CONSTRAINT renewal_requests_operation_key_key UNIQUE,
    provider_operation_id TEXT
        CONSTRAINT renewal_requests_provider_operation_key UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT renewal_requests_resource_workspace_fk
        FOREIGN KEY (resource_id, workspace_id)
        REFERENCES resources(id, workspace_id) ON DELETE RESTRICT,
    CONSTRAINT renewal_requests_thirty_days
        CHECK (new_expiry = old_expiry + 30),
    CONSTRAINT renewal_requests_no_self_decision
        CHECK (decision_by IS NULL OR decision_by <> created_by)
);

CREATE UNIQUE INDEX renewal_requests_one_active_per_resource
    ON renewal_requests (resource_id)
    WHERE status IN (
        'PENDING_APPROVAL',
        'PROCESSING',
        'NEEDS_ATTENTION'
    );

CREATE INDEX renewal_requests_workspace_status_created_idx
    ON renewal_requests (workspace_id, status, created_at DESC);

CREATE INDEX renewal_requests_resource_created_idx
    ON renewal_requests (resource_id, created_at DESC);

CREATE TABLE renewal_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL
        CONSTRAINT renewal_jobs_request_fk
        REFERENCES renewal_requests(id) ON DELETE RESTRICT
        CONSTRAINT renewal_jobs_request_key UNIQUE,
    status renewal_job_status NOT NULL DEFAULT 'PENDING',
    next_action renewal_job_action NOT NULL DEFAULT 'POST',
    attempts_in_cycle INTEGER NOT NULL DEFAULT 0
        CHECK (attempts_in_cycle BETWEEN 0 AND 3),
    total_post_attempts INTEGER NOT NULL DEFAULT 0
        CHECK (total_post_attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    execution_version BIGINT NOT NULL DEFAULT 0 CHECK (execution_version >= 0),
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    last_error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT renewal_jobs_lease_consistency CHECK (
        (lease_owner IS NULL AND lease_expires_at IS NULL)
        OR
        (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    )
);

CREATE INDEX renewal_jobs_due_idx
    ON renewal_jobs (next_attempt_at)
    WHERE status IN ('PENDING', 'RUNNING');

CREATE TABLE renewal_request_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL
        CONSTRAINT renewal_request_events_request_fk
        REFERENCES renewal_requests(id) ON DELETE RESTRICT,
    actor_type renewal_event_actor_type NOT NULL,
    actor_user_id UUID
        CONSTRAINT renewal_request_events_actor_fk
        REFERENCES users(id) ON DELETE RESTRICT,
    from_status renewal_request_status,
    to_status renewal_request_status NOT NULL,
    reason_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT renewal_request_events_actor_consistency CHECK (
        (actor_type = 'USER' AND actor_user_id IS NOT NULL)
        OR
        (actor_type = 'SYSTEM' AND actor_user_id IS NULL)
    ),
    CONSTRAINT renewal_request_events_creation_consistency CHECK (
        from_status IS NOT NULL OR to_status = 'PENDING_APPROVAL'
    )
);

CREATE INDEX renewal_request_events_request_created_idx
    ON renewal_request_events (request_id, created_at ASC);

-- Комментарии к реализации, не исполняемая часть спецификации:
--
-- 1. При approve request и resource блокируются в порядке request -> resource;
--    после ожидания блокировки статус и snapshot читаются повторно.
-- 2. При finalize resource обновляется условно:
--
--    UPDATE resources
--    SET expires_on = $new_expiry, updated_at = now()
--    WHERE id = $resource_id
--      AND expires_on = $old_expiry
--      AND amount_minor = $snapshot_amount
--      AND currency = $snapshot_currency;
--
--    Ноль обновлённых строк означает conflict: success-поля не сохраняются.
--    В ТОЙ ЖЕ транзакции request переводится в NEEDS_ATTENTION, job — в
--    WAITING_MANUAL, lease очищается и добавляется одно system history event.
--
-- 3. Каждый claim увеличивает execution_version. При claim просроченной
--    RUNNING job next_action устанавливается RECONCILE. Перед POST в той же
--    короткой claim transaction увеличиваются оба counters. Все последующие
--    scheduling/attention/finalize writes проверяют execution_version.
--
-- 4. Prisma schema не описывает partial unique index декларативно.
--    Нельзя удалять renewal_requests_one_active_per_resource при diff migrations.
