# Requirements Traceability Matrix

## 1. Назначение

Матрица показывает, что каждое обязательное требование имеет архитектурное решение, задачу реализации и проверку. Ссылки на задачи/tests описывают план, а не утверждают, что код уже реализован.

Статус бизнес-комплекта на момент создания: **Specified**. M0 infrastructure skeleton реализован отдельно и не закрывает бизнес-requirements. После реализации добавляется фактический результат/ссылка на test run, а идентификаторы сохраняются.

## 2. Требования → решения → реализация → тесты

| Requirement | PDF | Решение / спецификация | Roadmap | Основные проверки |
|---|---:|---|---|---|
| `FR-DATA-001` | 2 | [Product: seed](./product-spec.md#33-начальные-данные), [Data: seed](./data-model.md#7-seed-и-сброс) | `T01-02` | `TC-AUTH-003`, seed assertions, `TC-REQ-001` |
| `FR-DATA-002` | 2 | [ADR-0006](./adr/0006-date-and-money-semantics.md), [Data: serialization](./data-model.md#6-prisma-и-сериализация) | `T01-01`, `T02-01` | `TC-DATA-001…004` |
| `FR-DATA-003` | 2 | Resource request history и OpenAPI list/detail с `resourceId` filter | `T02-01`, `T04-02`, `T04-03` | `TC-DATA-005`, `TC-HIST-001`, `TC-UI-006` |
| `FR-AUTH-001` | 2 | [ADR-0007](./adr/0007-server-side-http-only-sessions.md), login/logout contracts | `T01-03`, `T04-01` | `TC-AUTH-001…006`, `TC-UI-001` |
| `FR-AUTH-002` | 2 | Server-derived `session.user_id`, active user и актуальные memberships | `T01-03` | `TC-AUTH-003…005`, `TC-AUTH-010`, `TC-AUTHZ-001` |
| `FR-AUTH-003` | 2 | [Error semantics](./product-spec.md#6-правила-http-ошибок), session expiry/revocation | `T01-03` | `TC-AUTH-001…002`, `TC-AUTH-006…007`, `TC-AUTHZ-001…002` |
| `FR-AUTH-004` | 2, дополнение | HttpOnly/Secure/SameSite cookie, hashed token, idle/absolute expiry | `T01-01`, `T01-03`, `T04-01` | `TC-AUTH-003`, `TC-AUTH-005…007` |
| `FR-AUTH-005` | 2, дополнение | Session-bound HMAC CSRF, Origin/Fetch Metadata, credentials CORS | `T01-03`, `T04-01` | `TC-AUTH-008…009`, unsafe mutation tests |
| `FR-TENANT-001` | 2 | Workspace-scoped queries, membership-first guard, composite FK | `T01-03`, `T02-01…03` | `TC-TENANT-001…004` |
| `FR-REQ-001` | 3 | Create use case и date-only +30 | `T02-02` | `TC-REQ-001`, `TC-DATA-001…002` |
| `FR-REQ-002` | 3 | Immutable snapshot в `renewal_requests` | `T01-01`, `T02-02` | `TC-REQ-001`, `TC-STATE-003`, `TC-REL-003` |
| `FR-REQ-003` | 3 | [ADR-0004](./adr/0004-concurrency-and-database-integrity.md), partial unique index + resource lock | `T01-01`, `T02-02` | `TC-REQ-002…004`, `TC-REL-010`, `TC-REL-017` |
| `FR-STATE-001` | 3 | [State machine](./product-spec.md#4-модель-состояния), locked transitions | `T02-03` | `TC-STATE-001…005`, `TC-REL-011` |
| `FR-STATE-002` | 3 | Server creator + self-decision guard + DB CHECK | `T01-03`, `T02-03` | `TC-AUTHZ-002`, `TC-STATE-001` |
| `FR-STATE-003` | 3 | Snapshot comparison под resource lock | `T02-03` | `TC-STATE-003`, provider stats=0 |
| `FR-STATE-004` | 3 | Reject transaction без job/provider | `T02-03` | `TC-STATE-001…002`, `TC-STATE-007`, `AC-08` |
| `FR-HIST-001` | 3 | Append-only events, USER/SYSTEM actor, safe codes | `T01-01`, `T02-02…03`, `T03-03…04` | `TC-HIST-001`, log inspection |
| `FR-INT-001` | 4 | [ADR-0003](./adr/0003-provider-idempotency-and-recovery.md), stable operation key | `T02-02`, `T03-01…03` | `TC-REL-003…004`, `TC-REL-010` |
| `FR-INT-002` | 4 | Immutable provider payload, period=1 | `T03-01` | `TC-REQ-001`, `TC-REL-003…004`, `TC-REL-013` |
| `FR-INT-003` | 4, 5 | Uncertain response protocol и RECONCILE | `T03-01…03` | `TC-REL-002…010`, `TC-REL-012` |
| `FR-REL-001` | 5 | [ADR-0002](./adr/0002-postgresql-backed-worker.md), approve transaction | `T02-03`, `T03-02` | `TC-REL-001`, `TC-STATE-004` |
| `FR-REL-002` | 5 | [Finalization transaction](./reliability.md#6-финализация) | `T03-04` | `TC-REL-003…005`, `TC-REL-014` |
| `FR-REL-003` | 5 | Fixed new expiry, completed no-op, unique provider operation | `T03-04` | `TC-REL-005`, `TC-DATA-004` |
| `FR-REL-004` | 5 | POST reservation/counters, GET not counted, attention | `T03-02…03` | `TC-REL-008…009`, `TC-REL-015` |
| `FR-REL-005` | 5 | Manual retry, новый cycle с прежним key, active index | `T03-03`, `T04-03` | `TC-REL-010…011`, `TC-UI-006` |
| `FR-REL-006` | 5 | `next_attempt_at`, configurable delay, lease/fencing/startup recovery | `T03-02…03` | `TC-REL-002…003`, `TC-REL-006…007`, `TC-REL-015`, `TC-REL-018…019` |
| `FR-REL-007` | 5 | Request lock + unique job + status recheck | `T02-03`, `T03-02` | `TC-STATE-004…005`, `TC-REL-016` |
| `FR-UI-001` | 6 | Login/list/create/detail/actions | `T04-01…03` | `TC-UI-001`, `TC-UI-006` |
| `FR-UI-002` | 6 | Status/history/errors/loading/empty, operation details | `T04-02…04` | `TC-UI-002`, `TC-UI-006` |
| `FR-UI-003` | 6 | Design tokens и desktop layout | `T04-04` | `TC-UI-004`, manual visual review |
| `FR-UI-004` | 6 | Mobile cards/responsive layout | `T04-04` | `TC-UI-005`, viewport 390 px |
| `FR-UI-005` | 6 | Semantic controls, focus, labels, keyboard dialog | `T04-04` | `TC-UI-003`, keyboard manual checklist |
| `FR-TEST-001` | 7 | [Test plan](./test-plan.md), API+real DB+provider lifecycle | `T05-01…04` | Весь P0 test suite, особенно `TC-REL-003…005` |
| `FR-DOC-001` | 5, 7, 8 | README contract в roadmap | `T06-01…03` | Clean checkout run и manual acceptance |
| `FR-DOC-002` | 8 | ADR/reliability/trade-offs и README limitations | `T06-01…03` | Documentation self-review |

## 3. Acceptance Criteria → тесты

| AC | Автоматическое доказательство | Дополнительная проверка |
|---|---|---|
| `AC-01` | `TC-REQ-001`, `TC-DATA-001` | UI create/detail |
| `AC-02` | `TC-REQ-002`, `TC-REQ-003` | SQL count active requests |
| `AC-03` | `TC-AUTH-001`, `TC-TENANT-001…004` | Known-ID curl scenario |
| `AC-04` | `TC-AUTHZ-002` | Universal login UI |
| `AC-05` | `TC-STATE-004`, `TC-STATE-005`, `TC-REL-001` | SQL job/event counts |
| `AC-06` | `TC-REL-002`, `TC-REL-003` | Ручной restart с delay=60000 |
| `AC-07` | `TC-REL-004`, `TC-REL-005`, `TC-DATA-004` | Provider GET/stats через curl |
| `AC-08` | `TC-STATE-001…002`, `TC-STATE-007` | Stats второго ресурса=0 |
| `AC-09` | `TC-REL-008…011` | UI attention/retry/history |
| `AC-10` | `TC-UI-001…006`, `TC-HIST-001` | Desktop/mobile/keyboard checklist |

## 4. Критерии полного покрытия

Перед сдачей необходимо проверить:

- нет requirement без задачи и теста;
- нет обязательного test в состоянии `skipped`/`todo`;
- каждый `409` conflict path имеет отдельный test;
- каждый terminal/active status используется в UI и DB tests;
- recovery проверяет и локальную БД, и provider stats;
- все P0 acceptance criteria прослеживаются до публичного API, а не только до service method;
- документация запуска содержит фактические команды, совпадающие с package scripts.

## 5. Обновление после реализации

### Снимок M0 — 2026-11-20

- `T00-01` — **Implemented locally**: pnpm workspaces, strict TypeScript, NestJS/Vite shells, ESLint, Vitest, env example и frozen lockfile. Проверки: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `T00-02` — **Implemented locally**: PostgreSQL 16.11 Compose config, Prisma baseline, health flow, Vite proxy и provider launch. Проверки: `apps/api/test/health.e2e-spec.ts` с реальной PostgreSQL, provider `/health`, browser smoke и `apps/web/src/app.test.tsx`.
- Health contract и generated types: `docs/openapi.yaml` → `packages/contracts/src/schema.ts`.
- Эти проверки не закрывают `FR-*`, `AC-*` или P0 `TC-*`; бизнес-статусы остаются **Specified**.

Для каждого requirement SHOULD фиксироваться:

- `Implemented` / `Partial` / `Not implemented`;
- ссылка на миграцию/модуль при необходимости;
- test file и название suite;
- дата последнего успешного прогона;
- известное ограничение, если поведение отличается от baseline.

Любое `Partial` или `Not implemented` MUST быть продублировано в итоговом README.
