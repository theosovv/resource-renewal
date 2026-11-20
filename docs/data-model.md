# Data Model and Database Integrity

## 1. Принципы

- PostgreSQL является источником истины для бизнес-состояния и выполнения jobs.
- Внутренние идентификаторы — UUID; provider использует отдельный `resources.external_id`.
- Timestamp — `TIMESTAMPTZ` в UTC; сроки ресурсов — `DATE`.
- Деньги — `BIGINT` в копейках с `CHECK >= 0`; валюта — `RUB`.
- Все ограничения из этого документа MUST попасть в Prisma migrations, включая те, которые невозможно декларативно описать в Prisma schema.
- Эталонный DDL находится в [schema.sql](./schema.sql). Это спецификация, а не готовая миграция.

## 2. Сущности

### `users`

| Поле | Тип | Правила |
|---|---|---|
| `id` | UUID | PK |
| `email` | TEXT | Unique; нормализуется к lowercase при seed/login |
| `display_name` | TEXT | Непустое |
| `password_hash` | TEXT | Argon2id; никогда не отдаётся в API |
| `is_active` | BOOLEAN | Неактивный пользователь получает `401` |
| `created_at`, `updated_at` | TIMESTAMPTZ | UTC |

### `auth_sessions`

| Поле | Тип | Правила |
|---|---|---|
| `id` | UUID | PK; входит в CSRF HMAC input |
| `user_id` | UUID | FK user; единственный identity link |
| `token_hash` | CHAR(64) | Unique SHA-256 hex hash raw opaque cookie token |
| `created_at` | TIMESTAMPTZ | Начало absolute lifetime |
| `last_seen_at` | TIMESTAMPTZ | Последний authenticated request |
| `idle_expires_at` | TIMESTAMPTZ | Sliding expiry, обновляется при authenticated request |
| `absolute_expires_at` | TIMESTAMPTZ | Фиксированный максимум, не продлевается |
| `revoked_at` | TIMESTAMPTZ | NULL для активной; logout устанавливает timestamp |

Raw session token, CSRF token и memberships в таблице не хранятся. CSRF вычисляется через HMAC от `id`, `token_hash`, назначения и server `CSRF_SECRET`. Истёкшие/revoked sessions не аутентифицируются даже до физического cleanup. Session переживает API restart, но не истечение срока.

### `workspaces`

| Поле | Тип | Правила |
|---|---|---|
| `id` | UUID | PK |
| `code` | TEXT | Unique; seed `ALPHA`, `BETA` |
| `name` | TEXT | `Alpha`, `Beta` |
| `created_at` | TIMESTAMPTZ | UTC |

### `workspace_memberships`

Составной PK `(workspace_id, user_id)`.

- `can_initiate` и `can_approve` представляют две независимые роли.
- CHECK требует хотя бы одну роль.
- Удаление membership запрещает доступ при следующем запросе, поскольку права не копируются в server-side session.

### `resources`

| Поле | Тип | Правила |
|---|---|---|
| `id` | UUID | PK |
| `workspace_id` | UUID | FK workspace |
| `external_id` | TEXT | Globally unique, например `res-a-01` |
| `name` | TEXT | Непустое |
| `expires_on` | DATE | Текущий срок |
| `amount_minor` | BIGINT | `>= 0` |
| `currency` | CHAR(3) | В MVP `RUB` |
| `created_at`, `updated_at` | TIMESTAMPTZ | UTC |

`UNIQUE(id, workspace_id)` поддерживает составной FK из заявки и не позволяет связать request с ресурсом другого пространства.

### `renewal_requests`

| Поле | Тип | Правила |
|---|---|---|
| `id` | UUID | PK |
| `workspace_id` | UUID | FK workspace |
| `resource_id` | UUID | Вместе с workspace FK на resource |
| `created_by` | UUID | Server-derived creator |
| `decision_by` | UUID | Approver при approve/reject; NULL до решения |
| `status` | ENUM | Пять бизнес-статусов |
| `old_expiry`, `new_expiry` | DATE | Immutable snapshot |
| `amount_minor`, `currency` | BIGINT, CHAR(3) | Immutable snapshot |
| `period_months` | SMALLINT | Только `1` |
| `operation_key` | TEXT | Unique, создаётся один раз |
| `provider_operation_id` | TEXT | Nullable unique |
| `created_at`, `updated_at` | TIMESTAMPTZ | UTC |
| `decided_at`, `completed_at` | TIMESTAMPTZ | Nullable |

Ограничения:

- `new_expiry = old_expiry + 30` на уровне PostgreSQL;
- `decision_by IS NULL OR decision_by <> created_by`;
- `operation_key` не изменяется после создания;
- поля snapshot обновляются только до создания записи; UPDATE snapshot в приложении отсутствует;
- `provider_operation_id` уникален, multiple NULL разрешены PostgreSQL.

### `renewal_jobs`

| Поле | Тип | Правила |
|---|---|---|
| `id` | UUID | PK |
| `request_id` | UUID | Unique FK, одна job на заявку |
| `status` | ENUM | `PENDING`, `RUNNING`, `WAITING_MANUAL`, `SUCCEEDED` |
| `next_action` | ENUM | `POST`, `RECONCILE` |
| `attempts_in_cycle` | INTEGER | `0..3`; сбрасывается manual retry |
| `total_post_attempts` | INTEGER | `>= 0`; никогда не сбрасывается |
| `next_attempt_at` | TIMESTAMPTZ | Persisted scheduling |
| `execution_version` | BIGINT | Монотонный fencing token, увеличивается при каждом claim |
| `lease_owner` | TEXT | Nullable worker instance UUID; не заменяет fencing token |
| `lease_expires_at` | TIMESTAMPTZ | Nullable |
| `last_error_code` | TEXT | Nullable safe code |
| `created_at`, `updated_at`, `completed_at` | TIMESTAMPTZ | Lifecycle |

Job создаётся только при approve. Для rejected/pending request её не существует.

### `renewal_request_events`

| Поле | Тип | Правила |
|---|---|---|
| `id` | UUID | PK |
| `request_id` | UUID | FK, index для истории |
| `actor_type` | ENUM | `USER`, `SYSTEM` |
| `actor_user_id` | UUID | Обязателен для USER, NULL для SYSTEM |
| `from_status` | ENUM | NULL только для создания |
| `to_status` | ENUM | Новый статус |
| `reason_code` | TEXT | Nullable allowlisted safe code |
| `created_at` | TIMESTAMPTZ | Время перехода |

Events append-only: update/delete endpoints отсутствуют. Для создания `from_status=NULL`, `to_status=PENDING_APPROVAL`.

## 3. Ключевое ограничение активной заявки

```sql
CREATE UNIQUE INDEX renewal_requests_one_active_per_resource
ON renewal_requests (resource_id)
WHERE status IN (
  'PENDING_APPROVAL',
  'PROCESSING',
  'NEEDS_ATTENTION'
);
```

Нельзя заменять это только предварительным `SELECT`: два параллельных запроса могут одновременно увидеть отсутствие записи. Сервис ловит PostgreSQL `23505` именно для этого constraint и возвращает `409 REQUEST_ALREADY_ACTIVE`.

`REJECTED` и `COMPLETED` исключены из индекса, поэтому после завершения допускается новая заявка, а вся история сохраняется.

## 4. Транзакционные границы

### Login и session lifecycle

Login атомарно создаёт session с уникальным `token_hash` и фиксированным `absolute_expires_at`. При authenticated request одним conditional UPDATE проверяется/обновляется session: `revoked_at IS NULL`, оба expiry находятся в будущем, затем обновляются `last_seen_at` и `idle_expires_at`; absolute expiry не изменяется. Ноль строк означает `401`. Logout условно устанавливает `revoked_at` текущей session и затем очищает cookie. Cleanup удаляет только старые expired/revoked записи и не участвует в бизнес-транзакциях.

### Create request

Одна транзакция:

1. `SELECT ... FOR UPDATE` ресурса в указанном workspace; после ожидания lock строка читается заново;
2. snapshot снимается с заблокированной строки, поэтому параллельная финализация не может вклиниться между read и insert;
3. insert request со snapshot и UUID operation key;
4. insert creation event;
5. commit освобождает resource lock.

Active unique index остаётся обязательным: resource lock сериализует корректный snapshot, а index окончательно запрещает вторую активную запись. Наличие membership и права проверяется сервером; клиент не передаёт creator/snapshot.

### Approve

Одна транзакция:

1. lock request;
2. lock resource;
3. повторно проверить status, self-decision и snapshot;
4. update request → `PROCESSING`;
5. insert job;
6. insert history.

Второй approver после ожидания lock обязан перечитать статус. Нельзя полагаться на данные, прочитанные до блокировки.

### Reject

Одна транзакция:

1. lock request;
2. проверить `PENDING_APPROVAL` и self-decision;
3. update → `REJECTED`;
4. сохранить decision metadata/history.

Resource и provider не затрагиваются.

### Finalize

Одна транзакция объединяет request, job, resource и history в порядке locks request → job → resource. Каждая запись проверяет `execution_version` текущего claim; просроченный владелец не может финализировать или изменить scheduling. Подробный протокол — в [reliability.md](./reliability.md#6-финализация).

### Manual retry

Одна транзакция блокирует request/job, проверяет `NEEDS_ATTENTION`, создаёт новый execution cycle и history.

## 5. Индексы

Минимальный набор:

- PK/FK и unique constraints из DDL, включая unique `auth_sessions.token_hash`;
- `(user_id)` для пользовательских sessions и `(absolute_expires_at)` для cleanup;
- active request partial unique index;
- `(workspace_id, status, created_at DESC)` для списка заявок;
- `(resource_id, created_at DESC)` для истории ресурса;
- `(request_id, created_at ASC)` для событий;
- due jobs partial index по `next_attempt_at` для `PENDING`/`RUNNING`.

При маленьком объёме MVP не требуются дополнительные индексы без измерения.

## 6. Prisma и сериализация

- Prisma model использует `DateTime @db.Date` для date-only и `BigInt @db.BigInt` для minor units.
- Date-only передаётся в API как `YYYY-MM-DD`; приложение не использует локальный timezone для расчёта.
- Внутри backend сумма может быть `bigint`; перед JSON сериализацией она проверяется на `Number.isSafeInteger` и преобразуется в JSON number. OpenAPI обозначает `integer/int64`.
- При обращении к provider сумма также должна быть JSON number. Значения вне безопасного диапазона JS отклоняются до HTTP; для seed-данных это не происходит.
- Enum values в API совпадают с DB enum names.
- Partial unique index добавляется вручную в SQL migration; комментарий в Prisma schema должен предотвратить его случайное удаление.

## 7. Seed и сброс

Seed использует insert-if-absent/upsert только для начальных пользователей, memberships и ресурсов на пустой/неизменённой базе. Существующие пользователи и их memberships не перезаписываются; membership создаётся вместе с новым seed user и не восстанавливается после явного удаления. Seed не должен «чинить» текущий ресурс после completed renewal.

Для воспроизводимой приёмки SHOULD быть отдельная команда `db:reset:test`, которая:

1. явно требует test/dev окружение;
2. очищает БД;
3. выполняет migrations и seed;
4. требует свежезапущенный provider simulator.

Production-like окружение в MVP отсутствует; опасный reset не должен быть доступен через HTTP.
