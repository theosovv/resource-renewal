# Resource Renewal

Приложение для согласования и выполнения заявок на продление ресурсов с ограниченным сроком действия.

> **Текущий статус — M0 Walking skeleton.** Настроены monorepo, NestJS/React shells, PostgreSQL, Prisma baseline, генерация OpenAPI-типов, provider launch, проверки и CI workflow. Реализован только сквозной health flow `web → API → PostgreSQL`; бизнес-функции MVP ещё не реализованы.

Исходное задание: [`Fullstack_практическое_задание.pdf`](./Fullstack_практическое_задание.pdf). PDF сохранён в репозитории; исходный `provider_simulator.py` извлечён из его вложения без изменений в [`tools/provider/provider_simulator.py`](./tools/provider/provider_simulator.py).

## Что работает на M0

- pnpm workspace с TypeScript strict mode и общим lockfile;
- NestJS API с prefix `/api/v1`;
- `GET /api/v1/health`, который выполняет настоящий `SELECT 1` через Prisma и возвращает `{"status":"ok"}` только после успешного обращения к PostgreSQL;
- React/Vite страница с loading/success/error и повторной проверкой соединения;
- Vite proxy `/api` для development server и production preview;
- PostgreSQL 16.11 в Docker Compose с healthcheck и persistent volume;
- Prisma schema baseline и generated Prisma Client;
- TypeScript-типы, генерируемые из `docs/openapi.yaml`;
- unit/component tests, отдельный API E2E с реальной PostgreSQL, lint/typecheck/build;
- запуск исходного provider simulator на `127.0.0.1:8091`;
- GitHub Actions workflow с PostgreSQL service и теми же проверками.

**Не реализовано:** миграции бизнес-сущностей, seed, login/sessions/CSRF, workspaces/resources/renewals, jobs/worker, provider client и основной пользовательский flow. Они запланированы на M1–M4. P0 acceptance suite ещё не выполнен и не объявляется пройденным.

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

`postinstall` автоматически выполняет Prisma Client generation и генерацию типов OpenAPI.

### 2. Запустить PostgreSQL

```bash
pnpm db:up
pnpm prisma:validate
pnpm test:e2e
```

`db:up` использует `docker compose up -d --wait`, поэтому команда завершается после успешного database healthcheck. Данные сохраняются в volume `resource-renewal_postgres_data`.

### 3. Запустить API и web

```bash
pnpm dev
```

Команда запускает оба процесса и останавливает их по `Ctrl+C`:

- web: <http://127.0.0.1:5173>;
- API health: <http://127.0.0.1:3000/api/v1/health>;
- health через Vite proxy: <http://127.0.0.1:5173/api/v1/health>.

Для отдельных терминалов:

```bash
pnpm dev:api
pnpm dev:web
```

API при старте подключается к PostgreSQL. Недоступная БД приводит к ошибке запуска, а не к ложному healthy state.

### 4. Запустить provider simulator

В отдельном терминале:

```bash
pnpm dev:provider
curl --fail http://127.0.0.1:8091/health
```

Ожидается `{"status":"ok"}`. Simulator хранит операции только в памяти процесса. На M0 приложение ещё не вызывает его; запуск нужен для проверки инфраструктурного контура и последующих этапов.

## Команды проверки

```bash
pnpm lint              # ESLint для всего monorepo
pnpm typecheck         # strict TypeScript во всех workspace-пакетах
pnpm test              # 3 API unit tests + 2 web component tests
pnpm test:e2e          # 1 API E2E; требует запущенную PostgreSQL и DATABASE_URL
pnpm build             # contracts, API и production web bundle
pnpm check             # lint + typecheck + test + build
pnpm prisma:validate   # валидация Prisma baseline; требует DATABASE_URL
```

Дополнительные команды:

| Команда | Назначение |
|---|---|
| `pnpm prisma:generate` | Сгенерировать Prisma Client |
| `pnpm contracts:generate` | Обновить `packages/contracts/src/schema.ts` из OpenAPI |
| `pnpm db:logs` | Логи PostgreSQL |
| `pnpm db:down` | Остановить PostgreSQL, сохранить volume |
| `pnpm preview:web` | Preview собранного web после `pnpm build` |
| `pnpm --filter @resource-renewal/api start` | Запустить собранный API после `pnpm build` |

При изменении `docs/openapi.yaml` нужно выполнить `pnpm contracts:generate` и включить изменённый generated file в тот же commit. CI проверяет, что генерация не создаёт diff.

## Production-build smoke (локально)

Это не deployment-конфигурация, а проверка собранных артефактов:

```bash
pnpm build
pnpm --filter @resource-renewal/api start
# В другом терминале:
pnpm preview:web
```

Preview также проксирует `/api` на `API_PROXY_TARGET`. Для полноценного deployment на M0 нет отдельной конфигурации, и она не входит в MVP.

## Конфигурация

Основные значения находятся в [`.env.example`](./.env.example).

| Переменная | Default в example | Назначение |
|---|---|---|
| `DATABASE_URL` | Локальная БД `resource_renewal` | Prisma/PostgreSQL connection string |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Локальные значения | Параметры Docker Compose PostgreSQL |
| `API_HOST`, `API_PORT` | `127.0.0.1`, `3000` | Адрес NestJS |
| `WEB_ORIGIN` | `http://127.0.0.1:5173` | Единственный credentials-aware CORS origin |
| `API_PROXY_TARGET` | `http://127.0.0.1:3000` | Цель Vite `/api` proxy |
| `COOKIE_SECURE` | `false` | Разрешён только явно локальный HTTP; будет использовано в M1 |
| `CSRF_SECRET`, `SESSION_*` | Локальные значения | Зарезервированы для server-side sessions в M1 |
| `PROVIDER_BASE_URL`, `PROVIDER_TIMEOUT_MS` | `http://127.0.0.1:8091`, `5000` | Конфигурация provider client для M3 |
| `WORKER_*`, `RENEWAL_*` | См. example | Конфигурация persistent worker для M3; worker на M0 не запускается |

Не помещайте реальные секреты в `.env.example`, логи или git.

## Структура

```text
apps/
├── api/                 # NestJS shell, PrismaService, health module и tests
└── web/                 # React/Vite shell и component tests
packages/
└── contracts/           # Генерируемые типы OpenAPI, без бизнес-логики
prisma/
└── schema.prisma        # M0 baseline; бизнес-миграции появятся в M1
tools/
└── provider/
    └── provider_simulator.py
docs/                    # Product specs, ADR, API/DB contracts и test plan
.github/workflows/ci.yml # Воспроизводимые CI-проверки
compose.yaml             # PostgreSQL 16.11
```

Frontend зависит только от HTTP-контракта и не импортирует Prisma/NestJS entities. Provider simulator и будущий worker остаются изолированными от HTTP controllers.

## Ограничения и следующий этап

- `prisma/schema.prisma` намеренно не содержит бизнес-моделей: полная схема, constraints и версионированные migrations — задача `T01-01`, а не пустая имитация готовности БД.
- Seed и безопасный test reset появятся в M1. До этого `docker compose down --volumes` — **опасная команда полного удаления локальной БД**, а не штатный reset.
- Health подтверждает только API и SQL round trip; он не доказывает готовность provider, worker или бизнес-операций.
- CSRF/session env уже задокументированы, но не считаются реализованной защитой до M1.
- `WORKER_ENABLED=true` в example не запускает worker на M0.
- P1 fault-injection tests и весь обязательный P0 suite остаются предметом M1–M5.

Следующий этап — **M1: PostgreSQL schema, seed, server-side sessions и авторизация** по [`docs/roadmap.md`](./docs/roadmap.md).

## Документация

Точка входа: [`docs/README.md`](./docs/README.md).

| Документ | Содержание |
|---|---|
| [Product Specification](./docs/product-spec.md) | Границы MVP, роли, 35 требований и acceptance criteria |
| [Architecture](./docs/architecture.md) | Целевые модули NestJS/React, конфигурация и последовательности |
| [Data Model](./docs/data-model.md) | Целевые сущности, snapshot и ограничения целостности |
| [Reliability](./docs/reliability.md) | Обязательный worker protocol, retry/reconcile, fencing и recovery |
| [OpenAPI](./docs/openapi.yaml) | Машинно-читаемый HTTP-контракт |
| [SQL Schema Specification](./docs/schema.sql) | Эталонный DDL для будущих Prisma migrations |
| [Test Plan](./docs/test-plan.md) | Обязательный P0 suite и ручная приёмка |
| [Roadmap](./docs/roadmap.md) | Этапы M0–M6 и Definition of Done |
| [Traceability Matrix](./docs/traceability-matrix.md) | Требование → решение → задача → тест |
| [ADR](./docs/adr/) | Причины архитектурных решений |

Целевые гарантии — одна активная заявка на ресурс, атомарный approve+job+history, стабильный `operation_key`, at-least-once processing, fencing через `execution_version` и однократная финализация. Их описание не означает реализацию на M0; нормативный протокол находится в [`docs/reliability.md`](./docs/reliability.md).

## Правила разработки

- Сначала обновляется спецификация, затем реализация и связанные тесты.
- Изменение HTTP API синхронизируется с `docs/openapi.yaml` и generated contracts.
- `docs/schema.sql` является спецификацией; фактическая схема создаётся версионированными Prisma migrations.
- Изменение требований синхронизируется с traceability matrix.
- Принятый ADR заменяется новым ADR, а не переписывается незаметно.
- Обязательные P0 tests нельзя оставлять `skipped` или заменять unit tests вспомогательных функций.
- Используются только вымышленные данные и локальные секреты.

Инструкции для coding agents и неподлежащие ослаблению инварианты находятся в [`AGENTS.md`](./AGENTS.md).
