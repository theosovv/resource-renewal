# Resource Renewal

Приложение для согласования и выполнения заявок на продление ресурсов с ограниченным сроком действия.

> **Текущий статус — M3 «Надёжная интеграция».** Реализованы полная PostgreSQL-схема, seed, server-side sessions и CSRF/CORS, resource/request API, бизнес-переходы, persistent worker, provider integration, recovery и transactional finalization. Основной UI и полный PDF acceptance flow относятся к следующим этапам.

Исходное задание: [`Fullstack_практическое_задание.pdf`](./Fullstack_практическое_задание.pdf). PDF сохранён в репозитории; исходный `provider_simulator.py` извлечён из его вложения без изменений в [`tools/provider/provider_simulator.py`](./tools/provider/provider_simulator.py).

## Что работает на M1–M3

- pnpm workspace с TypeScript strict mode, NestJS API `/api/v1`, React/Vite health shell и generated OpenAPI types;
- PostgreSQL 16.11 в Docker Compose и Prisma Client;
- migration `20261120130000_m1_business_schema` со всеми entities/enums/constraints/indexes из `docs/schema.sql`, включая partial unique index одной активной заявки;
- повторяемый seed двух workspaces, четырёх users/memberships и трёх resources; повторный запуск не дублирует записи и не откатывает бизнес-/authorization-состояние;
- отдельная подтверждаемая destructive-команда test/development reset;
- `POST /auth/login`, `GET /auth/me`, `GET /auth/csrf`, `POST /auth/logout` и `GET /workspaces`;
- opaque session token в `rr_session` HttpOnly cookie; в PostgreSQL сохраняется только SHA-256 hash;
- session timestamps и cookie expiry вычисляются по часам PostgreSQL; session-specific ответы имеют `Cache-Control: no-store`;
- idle expiry 30 минут, absolute expiry 8 часов, logout revocation, переживание restart API;
- session-bound HMAC-SHA-256 CSRF, проверка Origin/Fetch Metadata и credentials-aware CORS только для `WEB_ORIGIN`;
- активность пользователя и memberships перечитываются из БД на каждый authenticated request; membership/role guards используют только серверные данные;
- date-only и safe-bigint adapters;
- workspace-scoped resource list/detail и request list/detail с `resourceId`/`status` filters, execution state и history;
- create со snapshot `oldExpiry → oldExpiry + 30 calendar days`, stable UUID `operationKey`, USER creation event и resource row lock;
- approve/reject с request locks, self-decision и invalid-state checks; approve также проверяет snapshot под resource lock и атомарно создаёт `PENDING/POST` job;
- manual retry из `NEEDS_ATTENTION`: request/job locks, прежний key/total counter, новый `PENDING/RECONCILE` cycle и USER event;
- typed provider client с timeout, percent-encoded GET, immutable payload, проверкой result и безопасной классификацией ошибок без response-body logging;
- persistent in-process polling worker с PostgreSQL claim/`SKIP LOCKED`, lease, fencing `execution_version`, due scheduling и recovery просроченного `RUNNING` через RECONCILE;
- persisted POST counters и `next_attempt_at`, не более трёх automatic POST в cycle, final RECONCILE и атомарный переход в `NEEDS_ATTENTION/WAITING_MANUAL`;
- однократная transactional finalization `request → job → resource`, conditional resource update по snapshot, SYSTEM history и create-after-completed;
- unit/component tests и 57 API E2E на реальной PostgreSQL: auth/access, tenant isolation, transitions, concurrency, provider recovery, fencing, three-attempt/manual retry и finalization conflicts;
- GitHub Actions workflow с migrations, seed и теми же E2E.

**Не реализовано:** login/business UI, Playwright smoke и полный PDF acceptance flow. API/worker recovery и P0 reliability tests M3 выполнены, но весь P0 suite целиком ещё не объявляется пройденным до завершения UI и M5. Специализированные crash-boundary tests `TC-REL-006/007` остаются в remaining coverage.

## Точные версии

| Компонент | Зафиксированная/проверенная версия |
|---|---|
| Node.js | `24.12.0` (`.nvmrc`; диапазон engines — `>=22.12.0 <25`) |
| pnpm | `11.6.0` (`packageManager`) |
| PostgreSQL | `16.11`, image `postgres:16.11-alpine` |
| Python | `3.14.9`; сторонние Python-пакеты не нужны |
| NestJS | `12.6.0` |
| React | `19.3.1` |
| Vite | `8.3.8` |
| Prisma | `6.19.3` |
| Argon2 | `argon2@0.44.0`, режим Argon2id |
| TypeScript | `5.9.3` |

Остальные версии зафиксированы в [`pnpm-lock.yaml`](./pnpm-lock.yaml). Локальная инфраструктурная проверка выполнялась с Docker `29.9.3` и Docker Compose `5.7.0`.

## Быстрый запуск

### 1. Подготовить runtime и зависимости

```bash
# Если используется nvm:
nvm install
nvm use

corepack enable
corepack install --global pnpm@11.6.0

cp .env.example .env
pnpm install --frozen-lockfile
```

`.env` содержит только вымышленные локальные значения и исключён из git. Для отдельного окружения замените `CSRF_SECRET` и пароль БД; значения из `.env.example` не являются production-секретами.

`postinstall` выполняет только Prisma Client generation и генерацию типов OpenAPI; migrations/seed автоматически не запускаются.

### 2. Запустить PostgreSQL, migrations и seed

```bash
pnpm db:up
pnpm prisma:migrate:deploy
pnpm db:seed
pnpm test:e2e
```

`db:up` использует `docker compose up -d --wait`, поэтому команда завершается после database healthcheck. Данные сохраняются в volume `resource-renewal_postgres_data`.

Повторный `db:seed` безопасен для текущего resource expiry, заявок, паролей, активности пользователей и memberships: существующие записи не перезаписываются. Отсутствующие workspaces/users/resources дополняются, а membership создаётся только вместе с новым seed user — удалённое membership специально не восстанавливается.

### 3. Запустить API и web

```bash
pnpm dev
```

Команда запускает оба процесса и останавливает их по `Ctrl+C`:

- web health shell: <http://127.0.0.1:5173>;
- API health: <http://127.0.0.1:3000/api/v1/health>;
- login API: <http://127.0.0.1:3000/api/v1/auth/login>.

Для отдельных терминалов:

```bash
pnpm dev:api
pnpm dev:web
```

API при старте подключается к PostgreSQL. Недоступная БД приводит к ошибке запуска, а не к ложному healthy state. При `WORKER_ENABLED=true` persistent worker запускается в том же процессе API; для выполнения approved jobs должен быть запущен provider simulator. Неожиданный сбой polling/result write является fail-fast и завершает процесс, чтобы API не оставался живым с незаметно остановленным worker. Web по-прежнему показывает только health flow; login UI появится в M4.

### 4. Запустить provider simulator

```bash
pnpm dev:provider
curl --fail http://127.0.0.1:8091/health
```

Ожидается `{"status":"ok"}`. Simulator хранит операции только в памяти процесса и на первом POST для нового ключа сохраняет completed operation, но возвращает `503`. Worker считает результат неопределённым, сохраняет delayed RECONCILE и после restart получает прежний result по тому же ключу. Перезапуск simulator во время незавершённой операции не поддерживается.

## Локальные учётные записи

Все пароли вымышленные и предназначены только для локальной проверки. В БД сохраняются Argon2id hashes.

| Email | Пароль | Workspace | Роли |
|---|---|---|---|
| `initiator.alpha@example.test` | `AlphaInitiator!2027` | Alpha | `INITIATOR` |
| `approver.alpha@example.test` | `AlphaApprover!2027` | Alpha | `APPROVER` |
| `initiator.beta@example.test` | `BetaInitiator!2027` | Beta | `INITIATOR` |
| `universal.alpha@example.test` | `AlphaUniversal!2027` | Alpha | `INITIATOR`, `APPROVER` |

Login принимает только `email` и `password`. Неизвестные поля, включая `role`, `workspace` и `userId`, возвращают `400 VALIDATION_ERROR`; identity и права назначаются только сервером.

### Проверка login через curl

```bash
curl --fail-with-body -c /tmp/rr-cookies.txt \
  -H 'Origin: http://127.0.0.1:5173' \
  -H 'Content-Type: application/json' \
  --data '{"email":"initiator.alpha@example.test","password":"AlphaInitiator!2027"}' \
  http://127.0.0.1:3000/api/v1/auth/login

curl --fail-with-body -b /tmp/rr-cookies.txt \
  http://127.0.0.1:3000/api/v1/auth/me

curl --fail-with-body -b /tmp/rr-cookies.txt \
  http://127.0.0.1:3000/api/v1/auth/csrf
```

Login и `/auth/csrf` возвращают один и тот же 64-значный hex CSRF token текущей сессии. Для logout подставьте его в `X-CSRF-Token`:

```bash
curl --fail-with-body -b /tmp/rr-cookies.txt -c /tmp/rr-cookies.txt \
  -X POST \
  -H 'Origin: http://127.0.0.1:5173' \
  -H 'X-CSRF-Token: ПОДСТАВИТЬ_ТОКЕН' \
  http://127.0.0.1:3000/api/v1/auth/logout
```

Успешный logout возвращает `204`, отзывает только текущую session и очищает cookie. Raw session token не возвращается в JSON и не должен сохраняться в Web Storage. CSRF token SPA будет хранить только в памяти.

## Business API и worker на M3

Все пути ниже находятся под `/api/v1`, требуют session cookie и membership в `workspaceId` из path. POST также требует `Origin` из configured `WEB_ORIGIN` и session-bound `X-CSRF-Token`.

| Метод и путь | Назначение |
|---|---|
| `GET /workspaces/{workspaceId}/resources` | Ресурсы, date-only/minor-unit значения и `activeRequestId` |
| `GET /workspaces/{workspaceId}/resources/{resourceId}` | Resource detail внутри workspace |
| `GET /workspaces/{workspaceId}/requests` | Request list; optional query `resourceId` и `status` |
| `POST /workspaces/{workspaceId}/requests` | Create с телом ровно `{"resourceId":"UUID"}`; требуется `INITIATOR` |
| `GET /workspaces/{workspaceId}/requests/{requestId}` | Snapshot, execution state, resource и полная history |
| `POST /workspaces/{workspaceId}/requests/{requestId}/approve` | `PENDING_APPROVAL → PROCESSING` и durable job; требуется другой `APPROVER` |
| `POST /workspaces/{workspaceId}/requests/{requestId}/reject` | `PENDING_APPROVAL → REJECTED` без job/provider/resource mutation |
| `POST /workspaces/{workspaceId}/requests/{requestId}/retry` | `NEEDS_ATTENTION → PROCESSING` с прежним key и `RECONCILE`; требуется `APPROVER` |

Create возвращает `201`, approve/reject/retry — `200`. Ответ create/detail содержит `operationKey`, поэтому его не нужно искать через SQL. Вторая активная заявка возвращает `409 REQUEST_ALREADY_ACTIVE`; неверный переход — `409 INVALID_STATE_TRANSITION`; изменённый resource snapshot при approve — `409 RESOURCE_SNAPSHOT_MISMATCH`; собственное решение — `403 SELF_DECISION_FORBIDDEN`. HTTP endpoints не выполняют provider call синхронно: после commit approve worker асинхронно обрабатывает durable job.

### Состояния и восстановление

```text
PENDING_APPROVAL → PROCESSING → COMPLETED
                     └────────→ NEEDS_ATTENTION → PROCESSING (manual retry)
PENDING_APPROVAL → REJECTED
```

Первый POST резервирует counters в БД до HTTP и использует `operationKey` из request snapshot. Timeout/network/5xx после POST сохраняют `PENDING/RECONCILE`, `next_attempt_at = now() + RENEWAL_RETRY_DELAY_MS` и пустой lease. RECONCILE выполняет GET по percent-encoded ключу и не увеличивает POST counters. После третьего uncertain POST выполняется один последний GET; отсутствие подтверждения переводит request/job в `NEEDS_ATTENTION/WAITING_MANUAL`, поэтому четвёртого automatic POST нет. Manual retry сохраняет общий counter/key, сбрасывает только cycle counter и снова начинает с GET.

Каждый claim увеличивает `execution_version`; все writes после HTTP проверяют текущие request/job/version. Приложение обеспечивает at-least-once processing, но не заявляет exactly-once execution: внешний дубликат предотвращается provider idempotency key, а повторная локальная финализация является no-op. Resource получает сохранённый `new_expiry` одним conditional UPDATE; успех, job, provider operation ID и SYSTEM history фиксируются одной транзакцией. Неизменяемый simulator должен оставаться запущенным на протяжении recovery-сценария.

Для ручной приёмки после `503` удобно установить `RENEWAL_RETRY_DELAY_MS=60000`, остановить API/worker до наступления `next_attempt_at`, затем запустить его с той же БД и тем же provider. `operationKey` доступен в detail response; provider result и stats проверяются командами из `docs/test-plan.md`.

## Migrations, seed и сброс

| Команда | Назначение |
|---|---|
| `pnpm prisma:migrate:dev` | Создать/применить development migration через Prisma CLI |
| `pnpm prisma:migrate:deploy` | Применить версионированные migrations без генерации новой |
| `pnpm db:seed` | Повторяемо дополнить начальные данные |
| `pnpm db:reset:test` | Запустить guarded destructive reset; без подтверждений отказывается работать |
| `pnpm prisma:generate` | Сгенерировать Prisma Client |
| `pnpm prisma:validate` | Проверить Prisma schema |

Для локального development reset используйте явную команду:

```bash
NODE_ENV=development CONFIRM_DATABASE_RESET=resource_renewal pnpm db:reset:test
```

**Опасно:** команда удаляет схему выбранной БД через `prisma migrate reset`, заново применяет migrations и выполняет seed. `NODE_ENV` должен быть `test` или `development`, а `CONFIRM_DATABASE_RESET` должен точно совпадать с именем БД из `DATABASE_URL`. Через HTTP reset недоступен. Перед новой приёмкой также перезапустите provider simulator отдельно: его in-memory operations не очищаются командой БД.

`docker compose down --volumes` также является опасной командой полного удаления volume и не заменяет штатный reset.

## Команды проверки

```bash
pnpm lint              # ESLint для всего monorepo и Prisma scripts
pnpm typecheck         # strict TypeScript для Prisma scripts и workspace-пакетов
pnpm test              # 26 API unit tests + 2 web component tests
pnpm test:e2e          # 57 API E2E; реальная PostgreSQL, migrations, seed, real/fault providers
pnpm build             # contracts, API и production web bundle
pnpm check             # lint + typecheck + unit/component tests + build
pnpm prisma:validate   # валидация Prisma schema; требует DATABASE_URL
```

`test:e2e` создаёт отдельную временную схему `rr_test_*` для каждого test file, применяет туда migrations, запускает seed перед каждым тестом и удаляет схему после завершения. Постоянная development-схема `public` тестами не очищается. Пользователю PostgreSQL нужны права `CREATE`/`DROP SCHEMA`; локальный Compose user их имеет. Test files выполняются последовательно, worker выключен в обычных API tests и включён только в reliability suite. Настоящий simulator запускается свежим на `127.0.0.1:8091`; перед `pnpm test:e2e` нужно остановить отдельно запущенный `pnpm dev:provider`. Для ответов, которые simulator не воспроизводит, используется contract-compatible fault provider на случайном свободном порту. Recovery останавливает/запускает только приложение, сохраняя PostgreSQL и provider работающими.

M1 auth tests покрывают `TC-AUTH-001…010` в границах roadmap. Для role-downgrade используется test-only HTTP controller с production guards и реальной БД; он не входит в production `AppModule`. M2 suite `apps/api/test/renewals.e2e-spec.ts` добавляет 22 HTTP+PostgreSQL tests: `TC-REQ-001…004`, `TC-STATE-001…005/007`, `TC-AUTHZ-001…003`, object-level tenant checks, create/approve/reject/retry CSRF, user history, resource filters, atomic rollback и manual retry state. Currency-mismatch fixture временно удаляет и восстанавливает `resources_currency_check` только внутри disposable test schema; production constraint не ослабляется.

M3 suite `apps/api/test/reliability-real.e2e-spec.ts` проверяет `TC-REL-002…005` с настоящим simulator: первый 503, persisted delay, остановку до следующего provider call, restart, один operation/`started_count=1`, resource finalization, SYSTEM history, no-op repeat и create-after-completed. Этот recovery test пройден локально три раза подряд. `apps/api/test/reliability-fault.e2e-spec.ts` покрывает `TC-REL-008…019`, duplicate provider operation и claimability после GET 404/timeout. Гонка create/finalize подтверждает реальное ожидание resource row lock через `pg_stat_activity`, а не полагается только на sleep. Специализированные crash-before-first-POST и crash-after-200-before-finalize tests `TC-REL-006/007` ещё не добавлены.

Дополнительные команды:

| Команда | Назначение |
|---|---|
| `pnpm contracts:generate` | Обновить `packages/contracts/src/schema.ts` из OpenAPI |
| `pnpm db:logs` | Логи PostgreSQL |
| `pnpm db:down` | Остановить PostgreSQL, сохранить volume |
| `pnpm preview:web` | Preview собранного web после `pnpm build` |
| `pnpm --filter @resource-renewal/api start` | Запустить собранный API после `pnpm build` |

При изменении `docs/openapi.yaml` нужно выполнить `pnpm contracts:generate` и включить generated file в тот же commit. CI проверяет, что генерация не создаёт diff.

## Production-build smoke (локально)

Это не deployment-конфигурация, а проверка собранных артефактов:

```bash
pnpm build
pnpm --filter @resource-renewal/api start
# В другом терминале:
pnpm preview:web
```

Preview проксирует `/api` на `API_PROXY_TARGET`. Deployment и HA не входят в MVP.

## Конфигурация

Основные значения находятся в [`.env.example`](./.env.example).

| Переменная | Default в example | Назначение |
|---|---|---|
| `DATABASE_URL` | Локальная БД `resource_renewal` | Prisma/PostgreSQL connection string |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Локальные значения | Параметры Docker Compose PostgreSQL |
| `API_HOST`, `API_PORT` | `127.0.0.1`, `3000` | Адрес NestJS |
| `WEB_ORIGIN` | `http://127.0.0.1:5173` | Единственный credentials-aware CORS/Origin allowlist |
| `API_PROXY_TARGET` | `http://127.0.0.1:3000` | Цель Vite `/api` proxy |
| `COOKIE_SECURE` | `false` | `true` по умолчанию; `false` разрешён только для явно локального HTTP origin |
| `CSRF_SECRET` | Локальное значение | HMAC secret, минимум 32 байта |
| `SESSION_IDLE_TTL_SECONDS` | `1800` | Sliding idle expiry, 30 минут |
| `SESSION_ABSOLUTE_TTL_SECONDS` | `28800` | Непродлеваемый absolute expiry, 8 часов |
| `PROVIDER_BASE_URL`, `PROVIDER_TIMEOUT_MS` | `http://127.0.0.1:8091`, `5000` | Provider origin и bounded HTTP timeout |
| `WORKER_ENABLED`, `WORKER_POLL_INTERVAL_MS` | `true`, `1000` | In-process persistent worker и период polling |
| `RENEWAL_RETRY_DELAY_MS` | `15000` | Persisted пауза после uncertain POST/GET; для ручной приёмки можно `60000` |
| `RENEWAL_JOB_LEASE_MS` | `30000` | Lease владения job; должен быть больше provider timeout |

Не помещайте реальные секреты в `.env.example`, логи или git. Password hash, raw session/CSRF tokens, cookies и Authorization не логируются.

## Структура

```text
apps/
├── api/
│   ├── src/modules/auth/       # Sessions, CSRF, cookie и access guards
│   ├── src/modules/workspaces/ # Доступные текущему пользователю workspaces
│   ├── src/modules/resources/  # Workspace-scoped resource read API
│   ├── src/modules/renewals/   # Request API, transitions, finalization и history
│   ├── src/modules/jobs/       # Durable claim/scheduling и polling worker
│   ├── src/modules/provider/   # Typed isolated provider client
│   ├── src/modules/health/
│   └── test/                   # HTTP + реальная PostgreSQL, isolated schemas
└── web/                        # M0 health shell; основной UI запланирован на M4
packages/
└── contracts/                  # Генерируемые типы OpenAPI
prisma/
├── migrations/                 # Версионированная полная M1 schema
├── schema.prisma
├── seed.ts
├── seed-cli.ts
└── reset-test.ts
tools/
└── provider/provider_simulator.py
docs/                           # Specs, OpenAPI, SQL, ADR и test plan
.github/workflows/ci.yml
compose.yaml
```

Frontend зависит только от HTTP-контракта и не импортирует Prisma/NestJS entities. Provider client и worker изолированы от HTTP controllers.

## Ограничения и следующий этап

- Прямого изменения resource expiry/amount через API нет; resource меняет только transactional finalization worker.
- Login/business UI и Playwright smoke остаются на M4; полный PDF acceptance и единый финальный P0 run — на M5.
- Специализированные P1 crash-boundary tests `TC-REL-006` (до первого POST) и `TC-REL-007` (после provider 200 до finalization) ещё не реализованы; это не заменяет пройденный обязательный recovery `TC-REL-003`.
- Периодическая физическая очистка старых sessions не запланирована; expired/revoked records остаются недействительными независимо от cleanup.
- Worker обеспечивает at-least-once processing, не exactly-once execution. Перезапуск provider simulator во время pending operation и потеря PostgreSQL находятся вне гарантий MVP.

Следующий этап — **M4: login/business UI, history и действия approver** по [`docs/roadmap.md`](./docs/roadmap.md).

## Документация

Точка входа: [`docs/README.md`](./docs/README.md).

| Документ | Содержание |
|---|---|
| [Product Specification](./docs/product-spec.md) | Границы MVP, роли, требования и acceptance criteria |
| [Architecture](./docs/architecture.md) | Целевые модули NestJS/React и последовательности |
| [Data Model](./docs/data-model.md) | Сущности, snapshot, sessions и ограничения целостности |
| [Reliability](./docs/reliability.md) | Целевой worker protocol и recovery |
| [OpenAPI](./docs/openapi.yaml) | Машинно-читаемый HTTP-контракт |
| [SQL Schema Specification](./docs/schema.sql) | Эталонный DDL для Prisma migrations |
| [Test Plan](./docs/test-plan.md) | Обязательный P0 suite и ручная приёмка |
| [Roadmap](./docs/roadmap.md) | Этапы M0–M6 и Definition of Done |
| [Traceability Matrix](./docs/traceability-matrix.md) | Требование → решение → задача → тест |
| [ADR](./docs/adr/) | Причины архитектурных решений |

Протокол и гарантии worker описаны в [`docs/reliability.md`](./docs/reliability.md); фактически проверенные сценарии и оставшиеся ограничения перечислены выше.

## Правила разработки

- Сначала обновляется спецификация, затем реализация и связанные тесты.
- Изменение HTTP API синхронизируется с `docs/openapi.yaml` и generated contracts.
- `docs/schema.sql` является спецификацией; фактическая схема создаётся версионированными Prisma migrations.
- Partial unique index и CHECK constraints нельзя удалять при последующих diff migrations.
- Изменение требований синхронизируется с traceability matrix.
- Обязательные P0 tests нельзя оставлять `skipped` или заменять unit tests вспомогательных функций.
- Используются только вымышленные данные и локальные секреты.

Инструкции для coding agents и неподлежащие ослаблению инварианты находятся в [`AGENTS.md`](./AGENTS.md).
