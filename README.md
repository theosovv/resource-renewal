# Resource Renewal

Приложение для согласования и выполнения заявок на продление ресурсов с ограниченным сроком действия.

> **Текущий статус — M2 «Заявки и бизнес-переходы».** Реализованы полная PostgreSQL-схема, seed, server-side sessions и CSRF/CORS, resource/request API, создание со snapshot, approve/reject/manual retry, durable job и история. Persistent worker, provider client, финализация ресурса и основной UI относятся к следующим этапам и ещё не реализованы.

Исходное задание: [`Fullstack_практическое_задание.pdf`](./Fullstack_практическое_задание.pdf). PDF сохранён в репозитории; исходный `provider_simulator.py` извлечён из его вложения без изменений в [`tools/provider/provider_simulator.py`](./tools/provider/provider_simulator.py).

## Что работает на M1–M2

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
- unit/component tests и 46 API E2E на реальной PostgreSQL: auth/access, tenant isolation, seed/constraints, health, transitions и реальные parallel create/approve;
- GitHub Actions workflow с migrations, seed и теми же E2E.

**Не реализовано:** persistent worker, provider client, обработка provider result и финализация ресурса, login/business UI и полный PDF acceptance flow. На M2 approved job остаётся в БД, но не выполняется; `COMPLETED` и system history появятся в M3. P0 suite целиком ещё не выполнен и не объявляется пройденным.

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

API при старте подключается к PostgreSQL. Недоступная БД приводит к ошибке запуска, а не к ложному healthy state. На M2 web по-прежнему показывает только health flow; login UI появится в M4.

### 4. Запустить provider simulator

```bash
pnpm dev:provider
curl --fail http://127.0.0.1:8091/health
```

Ожидается `{"status":"ok"}`. Simulator хранит операции только в памяти процесса. На M2 приложение ещё не вызывает его из business flow; M2 E2E использует `/stats` и GET по rejected operation key, чтобы доказать отсутствие операций. Запуск нужен для проверки инфраструктурного контура и последующих этапов.

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

## Business API на M2

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

Create возвращает `201`, approve/reject/retry — `200`. Ответ create/detail содержит `operationKey`, поэтому его не нужно искать через SQL. Вторая активная заявка возвращает `409 REQUEST_ALREADY_ACTIVE`; неверный переход — `409 INVALID_STATE_TRANSITION`; изменённый resource snapshot при approve — `409 RESOURCE_SNAPSHOT_MISMATCH`; собственное решение — `403 SELF_DECISION_FORBIDDEN`. До M3 никакой из этих endpoints не выполняет provider HTTP, а approved job остаётся `PENDING` до появления worker.

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
pnpm test              # 13 API unit tests + 2 web component tests
pnpm test:e2e          # 46 API E2E; реальная PostgreSQL, migrations, seed и M2 provider stats
pnpm build             # contracts, API и production web bundle
pnpm check             # lint + typecheck + unit/component tests + build
pnpm prisma:validate   # валидация Prisma schema; требует DATABASE_URL
```

`test:e2e` создаёт отдельную временную схему `rr_test_*` для каждого test file, применяет туда migrations, запускает seed перед каждым тестом и удаляет схему после завершения. Постоянная development-схема `public` тестами не очищается. Пользователю PostgreSQL нужны права `CREATE`/`DROP SCHEMA`; локальный Compose user их имеет. Test files выполняются последовательно. Для M2 reject assertions suite сам запускает и останавливает свежий настоящий simulator на `127.0.0.1:8091`; приложение provider не вызывает. Перед `pnpm test:e2e` нужно остановить отдельно запущенный `pnpm dev:provider`: тест не подключается к potentially dirty процессу и не останавливает чужой simulator.

M1 auth tests покрывают `TC-AUTH-001…010` в границах roadmap. Для role-downgrade используется test-only HTTP controller с production guards и реальной БД; он не входит в production `AppModule`. M2 suite `apps/api/test/renewals.e2e-spec.ts` добавляет 22 HTTP+PostgreSQL tests: `TC-REQ-001…004`, `TC-STATE-001…005/007`, `TC-AUTHZ-001…003`, object-level tenant checks, create/approve/reject/retry CSRF, user history, resource filters, atomic rollback и manual retry state. Currency-mismatch fixture временно удаляет и восстанавливает `resources_currency_check` только внутри disposable test schema; production constraint не ослабляется. Completed/system history, create-after-completed и provider recovery остаются в M3/M5.

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
| `PROVIDER_BASE_URL`, `PROVIDER_TIMEOUT_MS` | `http://127.0.0.1:8091`, `5000` | Конфигурация provider client для M3 |
| `WORKER_*`, `RENEWAL_*` | См. example | Конфигурация persistent worker для M3; worker на M2 не запускается |

Не помещайте реальные секреты в `.env.example`, логи или git. Password hash, raw session/CSRF tokens, cookies и Authorization не логируются.

## Структура

```text
apps/
├── api/
│   ├── src/modules/auth/       # Sessions, CSRF, cookie и access guards
│   ├── src/modules/workspaces/ # Доступные текущему пользователю workspaces
│   ├── src/modules/resources/  # Workspace-scoped resource read API
│   ├── src/modules/renewals/   # Request API, transitions, jobs и history
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

Frontend зависит только от HTTP-контракта и не импортирует Prisma/NestJS entities. Provider simulator и будущий worker остаются изолированными от HTTP controllers.

## Ограничения и следующий этап

- Прямого изменения resource expiry/amount через API нет; resource меняет только будущая transactional finalization в M3.
- Persistent worker и provider client отсутствуют; `WORKER_ENABLED=true` в example не запускает worker на M2. Approved jobs сохраняются, но пока не выполняются.
- `COMPLETED`, system completion/attention history, create-after-completed и полный PDF recovery/acceptance flow ещё не реализованы.
- Login/business UI остаётся на M4.
- Периодическая физическая очистка старых sessions не запланирована; expired/revoked records остаются недействительными независимо от cleanup.
- P1 fault-injection tests и остальной P0 suite остаются предметом M3–M5.

Следующий этап — **M3: persistent worker, provider integration, recovery и финализация** по [`docs/roadmap.md`](./docs/roadmap.md).

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

Целевые гарантии worker описаны в [`docs/reliability.md`](./docs/reliability.md), но их описание не означает реализацию на M2.

## Правила разработки

- Сначала обновляется спецификация, затем реализация и связанные тесты.
- Изменение HTTP API синхронизируется с `docs/openapi.yaml` и generated contracts.
- `docs/schema.sql` является спецификацией; фактическая схема создаётся версионированными Prisma migrations.
- Partial unique index и CHECK constraints нельзя удалять при последующих diff migrations.
- Изменение требований синхронизируется с traceability matrix.
- Обязательные P0 tests нельзя оставлять `skipped` или заменять unit tests вспомогательных функций.
- Используются только вымышленные данные и локальные секреты.

Инструкции для coding agents и неподлежащие ослаблению инварианты находятся в [`AGENTS.md`](./AGENTS.md).
