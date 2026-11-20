# ADR-0001: Модульный монолит и pnpm-monorepo

- Статус: Accepted
- Дата: 2026-11-20

## Контекст

Задание требует небольшое fullstack-приложение за ограниченное время. Надёжность транзакций и воспроизводимость важнее распределённой архитектуры. API, web и worker используют один домен и одну PostgreSQL.

## Решение

Создать pnpm-monorepo с:

- `apps/api` — NestJS REST API;
- `apps/web` — React/Vite SPA;
- `packages/contracts` — типы, генерируемые из OpenAPI;
- общими `prisma/migrations` и seed;
- worker как логически отдельным модулем backend.

Backend разделяется на auth, workspaces, resources, renewals, jobs и provider. Нет отдельных микросервисов и независимых БД.

## Последствия

- Единый toolchain, type checking, test commands и lockfile.
- Простые локальные транзакции и запуск.
- Меньше boilerplate и operational overhead.
- Frontend не импортирует backend entities, поэтому HTTP-контракт остаётся явным.
- Worker можно отделить физически позже без изменения бизнес-модели.

## Альтернативы

- **Микросервисы:** отклонены как избыточные и усложняющие транзакции/recovery.
- **Два независимых репозитория:** отклонено, потому что задание требует самостоятельное приложение в одном репозитории.
- **Next.js/fullstack framework вместо NestJS + React:** не выбрано, поскольку задание прямо указывает Node.js/NestJS и React, а отдельные API и SPA делают границы проверяемыми.
