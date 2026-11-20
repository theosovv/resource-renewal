# ADR-0007: Server-side sessions в HttpOnly cookie

- Статус: Accepted
- Дата: 2026-11-20
- Supersedes: [ADR-0005](./0005-authentication-and-authorization.md)

## Контекст

Изначально для MVP был выбран JWT Bearer access token в `sessionStorage`. Это простое решение для API tests, но token доступен JavaScript при XSS, а добавление refresh tokens без rotation/replay protection не дало бы безопасной долгоживущей сессии.

Приложение — небольшой монолит с четырьмя локальными пользователями. Нет независимых клиентов или микросервисов, которым был бы необходим stateless JWT. Поэтому преимущества server-side revocation и HttpOnly cookie перевешивают дополнительную таблицу сессий.

## Решение

### Session credential

- При login создаётся новая `auth_sessions` запись и криптографически случайный opaque token длиной не менее 256 бит.
- В cookie передаётся raw token в base64url; в PostgreSQL сохраняется только SHA-256 hex hash. Высокая энтропия token не требует password-hashing KDF.
- Cookie: `rr_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, без `Domain`; `Secure` включён по умолчанию. Для локального HTTP допускается явный `COOKIE_SECURE=false`, который документируется как development-only.
- Session token не записывается в `localStorage`, `sessionStorage`, JWT или response body.
- Login всегда создаёт новую сессию, предотвращая session fixation. Повторный login MAY оставить другие активные сессии; logout отзывает только текущую.
- Raw token lookup выполняется по unique hash. Сессия должна существовать, быть не revoked и не expired; user должен быть active.

### Срок жизни

- Idle timeout: 30 минут (`SESSION_IDLE_TTL_SECONDS=1800`). Каждый authenticated request обновляет `last_seen_at` и `idle_expires_at`.
- Absolute timeout: 8 часов (`SESSION_ABSOLUTE_TTL_SECONDS=28800`) от создания и НЕ продлевается sliding activity.
- После idle/absolute expiry или logout cookie очищается, защищённые endpoints возвращают `401`.
- Expired/revoked records периодически удаляются после retention-интервала; немедленная очистка не требуется для безопасности.
- Refresh token отсутствует. После завершения сессии пользователь повторно проходит локальный login.

### CSRF

`SameSite=Lax` является дополнительным уровнем, а не единственной CSRF-защитой.

- Все authenticated unsafe methods требуют заголовок `X-CSRF-Token`.
- CSRF token — deterministic HMAC-SHA-256 с server `CSRF_SECRET` над `session.id`, `session.token_hash` и назначением `resource-renewal/csrf-v1`.
- Login response и authenticated `GET /auth/csrf` возвращают один и тот же per-session token. SPA хранит его только в памяти; при reload заново получает через `/auth/csrf`.
- Сервер пересчитывает HMAC и использует timing-safe comparison. CSRF token не логируется.
- Origin/Fetch Metadata проверяются как дополнительный уровень: неподходящий `Origin` или cross-site `Sec-Fetch-Site` отклоняется. Login без established session защищается JSON-only content type и Origin/Fetch Metadata validation.
- CORS разрешает credentials только для explicit `WEB_ORIGIN`; wildcard origin запрещён.

### Authorization

- Session содержит только `user_id` и lifecycle/security metadata.
- Memberships и роли по-прежнему загружаются из БД на каждый запрос и не копируются в session как авторитетные grants.
- Смена/удаление membership действует без перевыпуска session.
- Creator и decision actor определяются по `session.user_id`.

## Последствия

### Положительные

- Browser JavaScript не может прочитать session credential.
- Logout/expiry/revocation немедленно проверяются сервером.
- Нет refresh-token rotation, replay detection и второго долгоживущего credential.
- Session переживает restart API, поскольку находится в PostgreSQL.
- Роли остаются актуальными и серверными.

### Отрицательные

- Нужны `auth_sessions`, cookie parsing, CSRF и credentials-aware CORS.
- Каждый authorized request читает и обновляет session; при маленькой нагрузке MVP это приемлемо.
- Cookie auth требует дисциплины SameSite/Origin/CSRF; HttpOnly сам по себе не защищает от CSRF или XSS.
- API tests должны сохранять cookie jar и отдельно передавать CSRF token.
- Между idle update и абсолютным expiry существует небольшой объём DB writes; неприемлемый при высокой нагрузке throttling потребует отдельного решения.

## Альтернативы

- **JWT access + refresh:** отклонено для этого монолита; требует refresh rotation, reuse detection и token-family revocation.
- **JWT Bearer в Web Storage:** отклонено новым решением из-за доступности credential при XSS и отсутствия удобной серверной revocation.
- **Только SameSite cookie без CSRF token:** отклонено, SameSite не является полной CSRF-защитой.
- **Случайный CSRF token в plaintext session row:** допустимо, но HMAC даёт стабильный token для нескольких вкладок и не требует хранить/вращать второй secret в записи сессии.

## Граница защиты

HttpOnly защищает cookie от чтения через JavaScript, но не предотвращает выполнение запросов в контексте уже скомпрометированной страницы. XSS prevention, CSP и безопасный rendering остаются обязательными. Production deployment, MFA, SSO и cross-site cookie mode не входят в MVP.
