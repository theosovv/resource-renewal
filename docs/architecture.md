# Architecture Specification

## 1. Архитектурный обзор

Приложение — модульный монолит с REST API, SPA и persistent background worker. PostgreSQL хранит как бизнес-данные, так и очередь задач продления.

```text
React SPA
   │ HTTPS/HTTP, HttpOnly session cookie + CSRF header
   ▼
NestJS API ───────────────┐
   │                      │
   │ Prisma + SQL         │ provider HTTP client
   ▼                      ▼
PostgreSQL          Provider simulator
   ▲                      ▲
   │ leases/jobs          │ same operation key + immutable body
   └──── Renewal worker ──┘
```

Worker логически отделён от API, но в MVP MAY запускаться в том же процессе. Его состояние находится в PostgreSQL, поэтому новый процесс не зависит от памяти прежнего.

## 2. Технологии

| Область | Выбор |
|---|---|
| Язык | TypeScript strict mode |
| Пакеты | pnpm workspaces, точная версия в `packageManager` |
| Backend | NestJS, REST `/api/v1` |
| ORM | Prisma; parameterized raw SQL для row locks, partial indexes и atomic claim |
| БД | PostgreSQL 16+ |
| Frontend | React, Vite, React Router |
| Server state | TanStack Query |
| Формы | React Hook Form; серверная валидация остаётся обязательной |
| Типы API | Генерация TypeScript types из `docs/openapi.yaml` |
| Стили | CSS Modules/global design tokens без тяжёлого UI kit |
| API tests | NestJS testing module, Supertest, реальная PostgreSQL |
| UI smoke | Playwright; component/unit tests только где оправдано |

Точные версии фиксируются в lockfile и итоговом README на этапе walking skeleton. Предполагаемый baseline — Node.js 22 LTS или новее, pnpm 10+, Python 3.10+ для имитатора.

## 3. Предлагаемая структура репозитория

```text
apps/
├── api/
│   └── src/
│       ├── modules/
│       │   ├── auth/
│       │   ├── workspaces/
│       │   ├── resources/
│       │   ├── renewals/
│       │   ├── jobs/
│       │   ├── provider/
│       │   └── health/
│       ├── common/
│       └── main.ts
└── web/
    └── src/
        ├── features/auth/
        ├── features/resources/
        ├── features/renewals/
        ├── api/
        ├── components/
        └── styles/
packages/
└── contracts/          # сгенерированные типы OpenAPI, без бизнес-логики
prisma/
├── migrations/
└── schema.prisma
tools/
└── provider/           # предоставленный provider_simulator.py
docs/
```

Не предполагается общий пакет с entity классами NestJS или Prisma: frontend зависит только от HTTP-контракта.

## 4. Backend-модули

### Auth

- проверяет email/password и создаёт новую opaque server-side session в PostgreSQL;
- передаёт raw session token только в `HttpOnly SameSite=Lax` cookie, а в БД сохраняет SHA-256 hash;
- применяет idle expiry 30 минут и непродлеваемый absolute expiry 8 часов;
- загружает session, active user и memberships из БД для каждого авторизованного запроса;
- предоставляет `GET /auth/me`, `GET /auth/csrf` и `POST /auth/logout`; logout отзывает текущую session и очищает cookie;
- вычисляет session-bound HMAC CSRF token и требует `X-CSRF-Token` для authenticated unsafe methods;
- проверяет Origin/Fetch Metadata и настраивает credentials-aware CORS только для `WEB_ORIGIN`;
- не предоставляет registration/refresh в MVP. После expiry требуется повторный login.

### Workspaces

- возвращает только пространства текущего пользователя;
- проверяет membership до поиска объекта;
- предоставляет роли текущего пользователя для отображения доступных действий.

### Resources

- читает ресурсы только внутри авторизованного `workspaceId`;
- возвращает текущий срок, сумму и активную заявку;
- не предоставляет endpoint прямого изменения срока/стоимости.

### Renewals

- создаёт заявку и её snapshot;
- выполняет approve/reject/manual retry;
- возвращает список и detail с историей;
- владеет бизнес-переходами и транзакциями;
- не выполняет provider HTTP внутри request transaction.

### Jobs

- сохраняет durable execution state;
- выполняет claim/recovery задач по `next_attempt_at` и lease;
- увеличивает `execution_version` при каждом claim и проверяет его при каждой записи результата, чтобы отбрасывать ответы прежнего владельца просроченного lease;
- запускает polling worker при старту;
- ограничивает число автоматических POST и управляет `next_action`.

### Provider

- изолированный typed HTTP client;
- принимает `operationKey` и immutable payload;
- выполняет POST и percent-encoded GET;
- имеет bounded timeout;
- классифицирует результат как `confirmed`, `uncertain`, `not_found`, `non_retryable`;
- возвращает только allowlisted поля и безопасный код ошибки, не пробрасывает тело ответа в логи.

## 5. Frontend

### Страницы

1. `/login` — вход без регистрации.
2. `/w/:workspaceId/renewals` — сводный список ресурсов и заявок, counters и создание.
3. `/w/:workspaceId/renewals/:requestId` — snapshot, статус, execution details, история и действия.

После входа пользователь перенаправляется в своё единственное пространство или видит переключатель, если memberships несколько. Пользователь не может ввести чужое пространство и получить данные: сервер независимо повторяет проверку.

### Поведение

- Создание заявки инвалидирует queries ресурсов и заявок.
- `PROCESSING` MAY использовать polling с интервалом 2–3 секунды; после `COMPLETED`, `REJECTED` или `NEEDS_ATTENTION` polling прекращается, кроме ручного обновления.
- Mutation на время запроса блокирует только соответствующую кнопку, но не скрывает текущие данные.
- `409` вызывает refetch и показывает понятное сообщение: состояние уже изменилось, снимок устарел или есть активная заявка.
- `401` очищает user query cache и ведёт на login; `403` показывает отказ, не отзывая текущую сессию. При `403 CSRF_INVALID` token обновляется через `/auth/csrf`, после чего пользователь может повторить действие.
- Кнопки approve/reject/retry отображаются по роли и статусу, но это только UX, не механизм безопасности.
- Для approve/reject используется подтверждение с понятным описанием последствий; диалог доступен с клавиатуры.

### Session и CSRF в браузере

Browser автоматически отправляет HttpOnly cookie через HTTP client с `credentials: 'include'`. JavaScript не читает и не сохраняет session token. CSRF token получается из login response или `GET /auth/csrf`, хранится только в памяти SPA и передаётся в `X-CSRF-Token` для POST/PUT/PATCH/DELETE. После reload приложение восстанавливает пользователя через `/auth/me` и получает CSRF token заново. Logout вызывает CSRF-защищённый `POST /auth/logout`, затем очищает user data. XSS-защита, CSP и отсутствие `dangerouslySetInnerHTML` остаются обязательными: HttpOnly не мешает скомпрометированной странице выполнять действия от имени пользователя.

## 6. Конфигурация

| Переменная | Назначение | Пример/default для MVP |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | отдельная dev/test БД |
| `CSRF_SECRET` | HMAC session-bound CSRF tokens | не менее 32 случайных байт, отдельный local secret |
| `COOKIE_SECURE` | Атрибут Secure session cookie | `true`; `false` только для явно локального HTTP |
| `SESSION_IDLE_TTL_SECONDS` | Sliding inactivity timeout | `1800` |
| `SESSION_ABSOLUTE_TTL_SECONDS` | Непродлеваемый absolute timeout | `28800` |
| `PROVIDER_BASE_URL` | Имитатор | `http://127.0.0.1:8091` |
| `PROVIDER_TIMEOUT_MS` | Timeout POST/GET | `5000` |
| `WORKER_ENABLED` | Включение worker | `true` |
| `WORKER_POLL_INTERVAL_MS` | Период поиска due jobs | `1000` |
| `RENEWAL_RETRY_DELAY_MS` | Пауза после uncertain POST | `15000`; для ручной приёмки можно `60000` |
| `RENEWAL_JOB_LEASE_MS` | Lease выполнения | `30000`, больше provider timeout |
| `WEB_ORIGIN` | CORS allowlist | origin Vite dev server |

Значение retry delay выводится в README и может быть изменено без пересборки. Секреты не попадают в git, seed-пароли используются только локально.

## 7. Последовательности

### Создание

1. API проверяет session/CSRF и роль `INITIATOR` в пространстве.
2. Блокирует resource row внутри пространства и читает snapshot под lock.
3. Вычисляет `newExpiry = oldExpiry + 30 days` в date-only арифметике.
4. Создаёт request, operation key и history в той же транзакции.
5. Частичный unique index гарантирует отсутствие второй активной заявки; commit освобождает resource lock.

### Согласование

1. Проверяется `APPROVER`, затем request находится внутри пространства.
2. В транзакции блокируются request и resource в стабильном порядке.
3. Проверяются статус, `createdBy != actor`, snapshot ресурса.
4. Request переходит в `PROCESSING`; создаются job и history.
5. Только после commit изменение становится доступно worker.
6. API возвращает актуальную заявку; provider call выполняется асинхронно.

### Подтверждение

1. Worker получает подтверждение через POST или GET.
2. Проверяет operation key, `status=completed` и соответствие исходным полям.
3. В одной транзакции блокирует request → job → resource, проверяет `execution_version` и идемпотентно обновляет срок, request, job и history.
4. Повтор подтверждения завершается no-op для уже `COMPLETED` заявки с тем же provider result.

Подробный failure protocol описан в [reliability.md](./reliability.md).

## 8. Нефункциональные свойства

- **Security:** deny by default, hashed opaque sessions в HttpOnly cookie, idle/absolute expiry, CSRF HMAC, server-side membership checks, Argon2id, credentials-aware CORS allowlist и безопасные логи.
- **Reliability:** at-least-once processing, идемпотентный provider effect и однократная DB finalization.
- **Observability:** structured logs с request/job UUID, action, safe error code и duration; без secrets/full provider response.
- **Accessibility:** semantic HTML, labels, focus-visible, управление клавиатурой, достаточный контраст.
- **Reproducibility:** lockfile, миграции, повторяемый seed, env example, автоматический acceptance test.
- **Scope control:** нет брокера, deployment, registration и административных панелей.

## 9. Осознанные ограничения MVP

- Polling PostgreSQL не предназначен для высоконагруженной очереди.
- Нет горизонтального масштабирования и production monitoring, хотя lease/SKIP LOCKED допускают аккуратное расширение.
- Нет refresh token: server-side session ограничена idle/absolute timeout и после неё требуется повторный login. Нет MFA, SSO, cross-site cookie mode и административного session management.
- Нет pagination из-за фиксированного маленького набора данных.
- Перезапуск provider simulator во время pending operation не поддерживается.
- Брокер в будущем потребует transactional outbox; простая отправка сообщения после DB commit не считается достаточной миграцией.
