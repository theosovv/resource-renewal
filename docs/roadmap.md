# MVP Roadmap — 24–40 часов

## 1. Цель и бюджет

План рассчитан примерно на **37 часов** плюс до **3 часов резерва**. Это рабочая оценка, а не измеренный срок. Переход на server-side sessions добавил persistent session lifecycle и CSRF/CORS проверки. Приоритет соответствует весам задания: бизнес-корректность и надёжность → авторизация → UI → polish.

P0 означает обязательный acceptance suite; точный перечень test IDs зафиксирован в [test-plan.md](./test-plan.md#обязательный-p0-suite). P1 — дополнительные fault-injection/extended robustness проверки, не заменяющие P0.

До завершения P0 нельзя добавлять регистрацию, уведомления, deployment, broker, admin CRUD и другие расширения.

## 2. Порядок и зависимости

```text
M0 Walking skeleton
  → M1 DB/auth/seed
    → M2 Request lifecycle
      → M3 Provider reliability
      → M5 Integration acceptance
    → M4 UI (после стабилизации API contracts)
      → M5 UI smoke
        → M6 Delivery
```

M3 реализуется до основной UI-полировки, потому что recovery составляет 25% оценки и влияет на API/UI states. M4 может частично идти параллельно с M3 после фиксации OpenAPI, но один разработчик должен сохранять указанный приоритет.

## M0. Walking skeleton — 2 часа

| Задача | Содержание | Оценка |
|---|---|---:|
| `T00-01` | pnpm workspaces, TypeScript strict, NestJS/Vite shells, lint/typecheck/test scripts, env example, lockfile | 1 ч |
| `T00-02` | PostgreSQL dev config, Prisma baseline, health endpoint, подключение web→API, provider launch command | 1 ч |

**DoD:** чистый checkout позволяет запустить API/web и подключиться к PostgreSQL по README draft; CI/local scripts проходят на пустом skeleton. Точные версии зафиксированы.

**Факт (2026-11-20):** M0 реализован. Локально пройдены install с frozen lockfile, lint, strict typecheck, 5 unit/component tests, production build, Prisma validation, 1 E2E с реальной PostgreSQL 16.11, provider health и browser smoke через Vite proxy. Команды задокументированы в корневом README. GitHub Actions workflow добавлен; результат удалённого CI run здесь не утверждается.

## M1. БД, seed и доступ — 7 часов

| Задача | Содержание | Оценка |
|---|---|---:|
| `T01-01` | Миграции всех entities/enums/constraints/indexes из `schema.sql`, Prisma bigint/date adapters | 2 ч |
| `T01-02` | Повторяемый seed двух workspaces, четырёх users/memberships и трёх resources; safe test reset | 1 ч |
| `T01-03` | Login/logout/me/csrf, opaque hashed sessions, idle/absolute expiry, Argon2id, HttpOnly cookie, CSRF HMAC, Origin/CORS, active user lookup и workspace/role guards | 4 ч |

**DoD:** `TC-AUTH-001…003`, login-часть `TC-AUTH-004`, `TC-AUTH-005…007`, logout-часть `TC-AUTH-008`, `TC-AUTH-009` и `TC-AUTH-010` проходят; seed не дублируется; роли нельзя передать клиентом. Create-body часть `TC-AUTH-004` и CSRF business mutations выполняются в M2/M3, object-level tenant/action tests окончательно закрываются в M5.

**Факт (2026-11-20):** M1 реализован. Добавлены полная migration и Prisma models, non-destructive repeatable seed, guarded reset, auth/workspaces endpoints, hashed opaque sessions, idle/absolute expiry, CSRF/Origin/CORS и live guards. `TC-AUTH-010` проверен через test-only HTTP controller с production guards и реальной БД; бизнес-action assertions остаются в M2/M5. Локально пройдены 19 auth E2E, 4 database/seed E2E и health E2E, `pnpm check`, чистый guarded reset и пустой Prisma schema drift diff. Полный P0 suite ещё не выполнен.

## M2. Заявки и бизнес-переходы — 5 часов

| Задача | Содержание | Оценка |
|---|---|---:|
| `T02-01` | Resource list/detail, request list/detail, ISO date/minor unit serialization | 1 ч |
| `T02-02` | Create request со snapshot, +30 days, operation key, creation history, 23505→409 | 2 ч |
| `T02-03` | Approve/reject с locks, self-decision, stale snapshot, atomic job+history, invalid transitions | 2 ч |

**DoD:** `TC-REQ-001…004`, `TC-STATE-001…005`, `TC-STATE-007`, `TC-AUTHZ-002…003` и user-action часть `TC-HIST-001` зелёные; параллельные create/approve проверены реальной PostgreSQL. Completed/system history, create-after-completed и tenant retry проверяются после M3; provider ещё не вызывается, кроме stats assertions для отсутствия операций.

**Факт (2026-11-20):** M2 реализован. Добавлены resource/request list/detail, filters, create с resource lock/snapshot/+30/stable operation key, approve/reject с locks и history, atomic durable job и manual retry с прежним key. Точный partial-index conflict отображается в `REQUEST_ALREADY_ACTIVE`. `apps/api/test/renewals.e2e-spec.ts` содержит 22 проходящих HTTP+PostgreSQL tests, включая реальные parallel create/approve, три stale snapshot variants, rollback approve при forced history failure, tenant/role/CSRF и stats настоящего provider после reject. Полный текущий E2E suite — 46 passed; `pnpm check` и `pnpm prisma:validate` также прошли. Worker/provider execution, финализация и system/completed history остаются в M3; полный P0 ещё не выполнен.

## M3. Надёжная интеграция — 7 часов

| Задача | Содержание | Оценка |
|---|---|---:|
| `T03-01` | Typed provider client, timeout, percent-encoded GET, result validation, safe error classification/logging | 1 ч |
| `T03-02` | Persistent polling worker, claim, lease, due scheduling, recovery stale RUNNING | 2 ч |
| `T03-03` | POST/RECONCILE protocol, persisted delay/counters, 3 POST limit, attention и manual retry | 2 ч |
| `T03-04` | Однократная transactional finalization, conditional resource update, conflict/mismatch handling | 2 ч |

**DoD:** P0 reliability tests `TC-REL-001…005`, `TC-REL-008…011`, `TC-REL-017`, `TC-REL-019` зелёные, включая system history и create-after-completed. Provider stats подтверждает одну operation; restart не теряет job. P1 fault-injection cases либо зелёные, либо честно занесены в remaining coverage.

**Факт (2026-11-21):** M3 реализован. Добавлены typed provider client с timeout/percent-encoded GET/result validation, persistent in-process worker с `SKIP LOCKED`, lease/fencing и due scheduling, полный POST/RECONCILE protocol и transactional finalization. Duplicate `provider_operation_id` и resource/result conflicts атомарно приводят к guarded attention; неожиданная ошибка worker завершает процесс fail-fast. Полный E2E suite — 57 passed на реальной PostgreSQL, `pnpm check` и `pnpm prisma:validate` прошли. Обязательный recovery `TC-REL-003` против настоящего simulator прошёл три раза подряд; stats подтверждает `started_count=1` и `operation_count=1`. `TC-REL-008…019` проверены через contract-compatible fault provider и реальные lock/fencing assertions. В remaining coverage остаются специализированные crash-before-first-POST и crash-after-200-before-finalization tests `TC-REL-006/007`; UI и общий PDF/P0 acceptance относятся к M4–M5.

## M4. Frontend — 7 часов

| Задача | Содержание | Оценка |
|---|---|---:|
| `T04-01` | Login/logout, HttpOnly cookie credentials, in-memory CSRF/bootstrap, workspace selection, protected routing, generated API types | 1.5 ч |
| `T04-02` | Resource/request list, counters, status badges, date/money formatting, active request links | 1.5 ч |
| `T04-03` | Create dialog/form, request detail, history, approve/reject/retry, operation key для приёмки | 2 ч |
| `T04-04` | Loading/empty/error/refetch, keyboard/focus/labels, reference styling, 390 px layout | 2 ч |

**DoD:** `TC-UI-001…006`; основной flow не требует devtools/SQL, ошибки API понятны, нет horizontal page scroll.

**Факт (2026-11-21):** M4 реализован. Добавлены React Router, TanStack Query и React Hook Form, protected routes, login/logout/bootstrap, workspace gate, in-memory CSRF и generated-contract API client. Реализованы resource/request lists, counters, filters, create/detail/history, approve/reject/retry confirmations, execution/provider details и 2,5-секундный polling `PROCESSING`. 16 web unit/component tests покрывают login → create, approver actions, self-decision, `401/403/409`, CSRF refresh/repeat, loading/empty/error, keyboard dialog и date/money helpers. Реальный browser smoke с API/PostgreSQL/simulator прошёл login initiator → create → logout → login approver → approve → automatic `COMPLETED`; UI показал resource expiry `31.03.2027`, provider ID и SYSTEM history, provider подтвердил `started_count=1` и `operation_count=1`. Chromium checks на 1440×900 и 390 px подтвердили 32 px desktop title, 1120 px content и отсутствие horizontal page overflow. Полный автоматический Playwright/PDF/P0 acceptance остаётся на M5.

## M5. Автоматическая приёмка — 6 часов

Часть тестов пишется вместе с M1–M4; этот этап закрывает инфраструктуру и полный сценарий, а не начинает тестирование с нуля.

| Задача | Содержание | Оценка |
|---|---|---:|
| `T05-01` | Повторяемый integration harness: disposable PostgreSQL, migrations/seed, provider process, API lifecycle | 1 ч |
| `T05-02` | Довести auth/tenant/lifecycle suites, параллельные requests и DB assertions | 2 ч |
| `T05-03` | Recovery/restart, provider stats, one-time finalization, 3 attempts/manual retry | 2 ч |
| `T05-04` | Playwright smoke и accessibility/responsive checklist | 1 ч |

**DoD:** один test command воспроизводит P0 сценарии; recovery suite проходит трижды; нет skipped обязательных tests.

## M6. Сдача — 3 часа

| Задача | Содержание | Оценка |
|---|---|---:|
| `T06-01` | Актуализировать OpenAPI, README: versions/env/accounts/API/commands/delay/key/security trade-offs | 1.5 ч |
| `T06-02` | Прогнать ручной PDF acceptance, зафиксировать результаты и незавершённые пункты | 1 ч |
| `T06-03` | Удалить secrets/debug artifacts, проверить lockfile/migrations/чистый запуск, финальный self-review | 0.5 ч |

**DoD:** чистый запуск воспроизводим по README; все обязательные артефакты в репозитории; известные ограничения честно перечислены.

## 3. Сводная оценка

| Этап | Часы |
|---|---:|
| M0 | 2 |
| M1 | 7 |
| M2 | 5 |
| M3 | 7 |
| M4 | 7 |
| M5 | 6 |
| M6 | 3 |
| **Итого** | **37** |
| Резерв на defects | до 3 |

## 4. Приоритеты при нехватке времени

### Нельзя вырезать

- DB constraint одной активной заявки;
- server-side auth/tenant checks;
- self-decision и stale snapshot checks;
- atomic approve+job;
- stable key и recovery после первого 503;
- однократную финализацию;
- обязательные API+DB tests;
- инструкции воспроизведения.

### Можно упростить

- визуальные transitions/animations;
- дополнительные filters и counters сверх требований;
- pagination;
- расширенные unit tests вокруг тривиальных helpers;
- test hooks для редких crash boundaries, если обязательный recovery test полностью работает — ограничение указать в README.

Нельзя заменять обязательный сценарий дополнительным функционалом.

## 5. Definition of Done задачи

Задача закрыта, если:

1. связанные requirement IDs реализованы без скрытых отступлений;
2. API/DB contracts обновлены;
3. positive, negative и concurrency paths проверены там, где применимо;
4. миграции применяются на чистую БД;
5. логи не содержат запрещённых данных;
6. typecheck/lint/tests проходят;
7. traceability matrix и README обновлены при изменении поведения;
8. известные ограничения записаны, а не скрыты.

## 6. Риски и контроль

| Риск | Раннее действие |
|---|---|
| Prisma не выражает partial index/locks | В M1 проверить raw SQL migration и lock queries на реальной PostgreSQL |
| Cookie/CSRF/CORS ошибочно работают только в curl | В M1 проверить cookie jar + CSRF integration tests, затем реальный browser credentials flow |
| Recovery test флаки из-за timing | В M3 persisted state polling вместо произвольных sleep; configurable long delay |
| Worker молча умирает рядом с API | Fail-fast процесса/supervisor и startup recovery; проверка lifecycle |
| UI начат до стабилизации статусов | Сначала OpenAPI и M2/M3 states, затем generated types |
| Большой scope тестовых crash hooks | Обязательный PDF recovery раньше дополнительных fault-injection tests |
| Время уходит в pixel perfect | Соблюсти tokens/layout, не делать pixel-perfect в ущерб reliability/security |
