# ADR-0005: Локальная аутентификация и авторизация по membership

- Статус: Superseded by ADR-0007
- Дата: 2026-11-20

> Историческое решение. Для реализации используется [ADR-0007: Server-side sessions в HttpOnly cookie](./0007-server-side-http-only-sessions.md). Описанный ниже JWT/Web Storage подход больше не является целевым.

## Контекст

Нужны четыре локальных тестовых аккаунта, две роли и строгая изоляция пространств. Регистрация и SSO не требуются. Клиент не должен иметь возможность назначить себе роль или пространство через запрос.

## Решение

### Authentication

- Локальный login по email/password.
- Пароли seed-пользователей хешируются Argon2id; plaintext используется только для локального входа и документируется как вымышленный test credential.
- API выдаёт signed JWT access token с TTL, содержащий `sub`, `iat`, `exp`, `iss`, `aud`.
- Token передаётся как `Authorization: Bearer`.
- SPA хранит token в `sessionStorage` текущей вкладки; logout удаляет token. Refresh flow в MVP отсутствует.

### Authorization

- Отдельная таблица `workspace_memberships` содержит `can_initiate` и `can_approve`.
- На каждый authorized request backend загружает active user и актуальные memberships.
- JWT НЕ содержит авторитетных ролей или workspace grants.
- Guard сначала проверяет authentication, затем membership в `workspaceId` из path, затем роль и объект внутри workspace.
- Creator/decision user определяются сервером по `sub`.
- Self-approval и self-rejection запрещены независимо от ролей.

## Последствия

### Положительные

- API легко проверять Supertest и curl.
- Membership можно отозвать без перевыпуска token.
- Нет stateful session store и отдельного auth service.
- Роли не могут быть подделаны редактированием request body или клиентского token payload без валидной подписи.

### Отрицательные

- `sessionStorage` доступен JavaScript и уязвим при XSS; это допустимый компромисс только для вымышленных данных MVP.
- JWT не отзывается мгновенно, но membership/active user проверяются из БД, а TTL ограничен.
- Production-вариант предпочтительнее использует Secure HttpOnly cookie, CSRF-защиту и управление сессиями.

## Альтернативы

- **Роли в JWT:** отклонено, поскольку они могут устареть и создают соблазн считать claims единственным источником прав.
- **Workspace/role в request body:** прямо запрещено заданием.
- **Basic Auth:** проще, но хуже соответствует login UI и передаёт пароль при каждом запросе.
- **DB-backed cookie session:** хороший production-like вариант, но требует session storage, cookie/CSRF handling и увеличивает объём MVP.
