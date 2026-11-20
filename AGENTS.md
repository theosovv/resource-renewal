# AGENTS.md

Инструкции применяются ко всему репозиторию, если вложенная директория не содержит более специфичный `AGENTS.md`.

## 1. Текущее состояние

- Репозиторий содержит исходное PDF-задание и комплект спецификаций в `docs/`.
- Код, package scripts, Prisma migrations и executable tests пока не созданы.
- Не утверждай, что приложение запускается или тесты проходят, пока это не проверено фактически.
- Не выдумывай команды запуска. После появления реализации используй реальные scripts и синхронно обновляй корневой README.

Начинай знакомство с проектом с `README.md`, `docs/README.md`, `docs/product-spec.md` и затронутых ADR.

## 2. Источники истины

При противоречии используй приоритет:

1. `Fullstack_практическое_задание.pdf`;
2. `docs/product-spec.md`;
3. принятые ADR;
4. `docs/architecture.md`, `docs/data-model.md`, `docs/reliability.md`;
5. примеры.

Для отдельных контрактов:

- HTTP API — `docs/openapi.yaml`;
- целевая БД — `docs/schema.sql` и `docs/data-model.md`;
- фактическая БД после реализации — версионированные Prisma migrations, которые MUST сохранять специфицированные ограничения;
- порядок работ — `docs/roadmap.md`;
- обязательные проверки — P0 suite в `docs/test-plan.md`.

Не удаляй исходный PDF. Не меняй требования незаметно через код.

## 3. Spec-Driven Development

При изменении поведения:

1. Найди существующие `FR-*`, `AC-*`, `T-*` и `TC-*`.
2. Сначала обнови затронутые спецификации.
3. Обнови OpenAPI/SQL specification и traceability matrix, если контракт меняется.
4. Для смены архитектурного решения создай новый ADR со связью `Supersedes`/`Superseded by`; не переписывай принятое решение задним числом.
5. Реализуй изменение и проверки.
6. Обнови README, если меняются команды, конфигурация, ограничения или сценарий проверки.

Идентификаторы требований и тестов стабильны. Не переиспользуй их для другого поведения.

## 4. Стек и границы MVP

Целевой стек:

- TypeScript strict mode;
- NestJS REST `/api/v1`;
- React + Vite;
- PostgreSQL 16+;
- Prisma + parameterized raw SQL для partial indexes, row locks и claim/fencing;
- pnpm workspaces.

Не добавляй без изменения спецификации и явной необходимости:

- регистрацию, SSO, notifications;
- отдельный broker;
- deployment/HA-инфраструктуру;
- admin CRUD;
- дополнительные валюты и произвольные периоды продления;
- микросервисы.

Дополнительный функционал не заменяет обязательный acceptance flow.

## 5. Неподлежащие ослаблению инварианты

### БД и конкурентность

- Partial unique index `renewal_requests_one_active_per_resource` обязателен. Не заменяй его предварительным `SELECT`.
- Активные статусы: `PENDING_APPROVAL`, `PROCESSING`, `NEEDS_ATTENTION`.
- Approve + job + history выполняются одной транзакцией.
- После ожидания любой блокировки статус/snapshot читаются повторно.
- Create блокирует resource до чтения snapshot; это предотвращает гонку с finalize.
- При операциях request/job/resource используй порядок locks `request → job → resource`. Approve использует `request → resource` до создания новой job; create удерживает resource-only lock.
- Unique constraints обязательны для `request_id` job, `operation_key` и `provider_operation_id`.
- SQL `23505` mapping выполняется по конкретному constraint; не превращай любую DB error в business `409`.

### Worker и провайдер

- Не храни критичное execution state только в памяти.
- Используй at-least-once processing. Не заявляй exactly-once execution.
- POST counters увеличиваются до provider HTTP; GET не считается POST-attempt.
- Все retries используют прежний `operation_key` и immutable payload из request snapshot.
- После uncertain POST job возвращается в `PENDING`, имеет `next_action=RECONCILE`, persisted `next_attempt_at` и очищенный lease.
- Каждый claim увеличивает `execution_version`.
- Каждый scheduling/attention/finalize write после HTTP проверяет текущий `execution_version`, request `PROCESSING` и job `RUNNING`.
- Поздний ответ прежнего lease owner отбрасывается. Текущий owner выполняет reconciliation.
- Не держи DB transaction открытой во время HTTP.
- После трёх uncertain POST выполняется RECONCILE, затем guarded attention при отсутствии результата. Четвёртого automatic POST нет.
- Каждый переход в `NEEDS_ATTENTION` атомарно устанавливает job `WAITING_MANUAL`, очищает lease, сохраняет safe error и добавляет одно system event.
- `WAITING_MANUAL` не выбирается automatic worker. Нужен явный approver retry.
- Manual retry начинается с RECONCILE, сбрасывает только cycle counter и сохраняет общий counter/key.

Полный протокол обязателен к прочтению перед изменением worker: `docs/reliability.md`.

### Финализация

- Provider result проверяется: completed status, `started_count=1`, operation ID и совпадение исходных полей.
- Финализация разрешена только из request `PROCESSING` и job `RUNNING` текущего `execution_version`.
- Resource обновляется одним conditional UPDATE по старому expiry/amount/currency.
- Устанавливается сохранённый `new_expiry`, а не `current expiry + 30`.
- Success transaction объединяет resource/request/job/history.
- При zero-row resource update success-поля не сохраняются; attention/job/history фиксируются в той же транзакции.
- Повторная финализация с тем же provider operation — no-op.
- Уже `COMPLETED` request нельзя перезаписать поздним attention или другим operation ID.

### Auth и tenant isolation

- Целевое решение — [ADR-0007](docs/adr/0007-server-side-http-only-sessions.md): opaque server-side session, а не JWT/Bearer/Web Storage. ADR-0005 является историческим.
- При login создаётся новая `auth_sessions` запись и случайный token ≥256 бит; raw token передаётся только в `rr_session` HttpOnly cookie, PostgreSQL хранит SHA-256 hash.
- Cookie: `SameSite=Lax`, `Path=/`, без Domain; `Secure` по умолчанию, отключение только для явно локального HTTP.
- Idle expiry — 30 минут с sliding activity; absolute expiry — 8 часов без продления. Refresh token отсутствует.
- Logout отзывает текущую session и очищает cookie; expired/revoked sessions возвращают `401` даже до cleanup.
- Identity определяется по `session.user_id`; creator/decision actor — только сервером.
- Memberships и active user загружаются из БД; роли/workspace/user ID в cookie или request body не являются источником прав.
- Все authenticated unsafe methods требуют session-bound `X-CSRF-Token`; отсутствие/ошибка → `403 CSRF_INVALID` без mutation.
- CSRF token — HMAC-SHA-256 по ADR-0007; хранится в SPA только в памяти и получается из login response или `/auth/csrf`. Не логируй raw session/CSRF tokens.
- Проверяй Origin/Fetch Metadata и credentials-aware CORS только для configured `WEB_ORIGIN`; SameSite без CSRF недостаточен.
- Проверка membership в path workspace предшествует поиску объекта.
- Нет валидной session → `401`; нет membership/роли или self-decision → `403`; объект не найден внутри доступного workspace → `404`.
- Alpha/Beta queries всегда workspace-scoped, включая known-ID reads и mutations.
- Universal не может approve/reject собственную заявку.
- Пароли — Argon2id hashes; plaintext существует только как вымышленный local test credential.
- HttpOnly не устраняет XSS-риск выполнения действий через скомпрометированную страницу; сохраняй CSP и безопасный rendering.

### Данные и API

- Сроки — PostgreSQL `DATE`, JSON `YYYY-MM-DD`; +30 календарных дней через date-only/UTC-арифметику.
- Деньги — `BIGINT` minor units; JSON/provider integer только после safe-integer проверки Prisma bigint.
- `currency=RUB`, `period_months=1`.
- Не сериализуй password hash, token или secrets.
- Не логируй полный provider response, Authorization, cookies, raw session/CSRF tokens и passwords.
- Не добавляй endpoint прямого изменения resource expiry/amount для обхода workflow.

## 6. Тестирование

- Доказательство transitions/concurrency/transactions требует HTTP API + реальную PostgreSQL.
- SQLite, mock Prisma или unit tests helpers не заменяют P0 integration tests.
- Проверяй как ответ API, так и состояние таблиц/history/jobs/resource.
- API tests используют cookie jar и CSRF token; отдельно проверяй hashed-at-rest session, logout revocation, idle/absolute expiry, cookie attributes, live user/membership revocation с прежней cookie и отсутствие mutations без CSRF.
- Parallel create/approve должны запускаться реальными конкурентными requests.
- Recovery test останавливает и запускает приложение, сохраняя работающими PostgreSQL и provider.
- Обязательный recovery проходит против настоящего `provider_simulator.py`.
- Ответы, которые настоящий имитатор не может воспроизвести, проверяются contract-compatible fault provider/proxy; это не заменяет тест настоящего имитатора.
- Не используй произвольные sleeps как единственную синхронизацию. Жди persisted job state или публичного результата с timeout.
- Не оставляй P0 tests `skipped`/`todo`. Нереализованные P1 fault-injection tests явно перечисляй в README.

Перед изменением tests сверься с `docs/test-plan.md` и `docs/traceability-matrix.md`.

## 7. UI

- Поддерживай login, workspace, resource/request list, create, detail/history, approve/reject/retry.
- Обрабатывай loading, empty, error, `401`, `403` и `409` без скрытия состояния.
- Client-side visibility кнопок не считается authorization.
- Основные действия доступны с клавиатуры; labels и focus-visible обязательны.
- Проверяй 1440×900 и 390 px без horizontal page scroll.
- Не используй `dangerouslySetInnerHTML` без крайней необходимости и явной sanitization.

## 8. Стиль реализации

- Сохраняй модульные границы auth/workspaces/resources/renewals/jobs/provider.
- Frontend зависит от OpenAPI contract, а не импортирует Prisma/NestJS entities.
- Делай provider client и worker protocol изолированными от HTTP controllers.
- Используй малые короткие DB transactions; не смешивай внешний HTTP с ними.
- Предпочитай существующие специфицированные решения и минимальный набор зависимостей.
- Документация — на русском; идентификаторы, статусы, коды ошибок и API fields — на английском в установленном формате.
- Не вводи production-only сложность в ущерб P0, но не упрощай correctness/security ради скорости.

## 9. Definition of Done

Перед завершением задачи:

1. Реализация соответствует связанным requirement IDs.
2. OpenAPI, schema/migrations, ADR и traceability обновлены при необходимости.
3. Проверены positive, negative и concurrency/recovery paths, где применимо.
4. Чистая БД мигрируется, seed повторяем и не затирает бизнес-операции.
5. Выполнены доступные фактические typecheck/lint/test commands; результаты описаны честно.
6. Нет secrets, реальных данных, debug artifacts и запрещённых логов.
7. README содержит актуальные команды, конфигурацию и известные ограничения.
8. Незавершённое поведение явно названо, а не скрыто формулировкой «готово».
