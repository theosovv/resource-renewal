# Resource Renewal

Приложение для согласования и выполнения заявок на продление ресурсов с ограниченным сроком действия.

> **Текущий статус:** подготовлена документация для Spec-Driven Development. Код приложения, миграции и executable tests пока не реализованы. Команды запуска будут добавлены вместе с walking skeleton на этапе M0.

## Задача

Инициатор создаёт заявку на продление ресурса, другой сотрудник согласовывает или отклоняет её, после чего background worker отправляет операцию тестовому провайдеру.

Главная сложность — первый ответ провайдера может быть `503`, хотя операция уже сохранена. Приложение должно восстановиться после перезапуска, использовать прежний ключ идемпотентности и не продлить ресурс дважды.

Исходное задание: [`Fullstack_практическое_задание.pdf`](./Fullstack_практическое_задание.pdf). PDF также содержит вложения `provider_simulator.py` и `reference_renewals.png`.

## Документация

Точка входа: [`docs/README.md`](./docs/README.md).

| Документ | Содержание |
|---|---|
| [Product Specification](./docs/product-spec.md) | Границы MVP, пользователи, 35 требований, HTTP-ошибки и acceptance criteria |
| [Architecture](./docs/architecture.md) | Целевой стек, модули NestJS/React, конфигурация и последовательности |
| [Data Model](./docs/data-model.md) | Сущности, snapshot, ограничения целостности и транзакционные границы |
| [Reliability](./docs/reliability.md) | Persistent worker, retry/reconcile, fencing, recovery и матрица отказов |
| [OpenAPI](./docs/openapi.yaml) | Машинно-читаемый HTTP-контракт |
| [SQL Schema Specification](./docs/schema.sql) | Эталонный DDL PostgreSQL; не заменяет Prisma migrations |
| [Test Plan](./docs/test-plan.md) | Обязательный P0 suite, recovery, concurrency, UI и ручная приёмка |
| [Roadmap](./docs/roadmap.md) | Поэтапная реализация на 37 часов плюс до 3 часов резерва |
| [Traceability Matrix](./docs/traceability-matrix.md) | Требование → ADR/спецификация → задача → тест |
| [ADR](./docs/adr/) | Причины выбора архитектуры, worker, идемпотентности, auth и типов данных |

## Целевой стек

- TypeScript в strict mode;
- NestJS REST API;
- React + Vite SPA;
- PostgreSQL 16+;
- Prisma migrations и parameterized raw SQL для специальных constraints/locks;
- pnpm workspaces;
- фоновый worker поверх durable jobs в PostgreSQL, без отдельного брокера в MVP.

## Ключевые инварианты

1. Один ресурс может иметь не более одной активной заявки; это гарантируется частичным уникальным индексом PostgreSQL.
2. Согласование, создание job и запись истории атомарны.
3. Все обращения к провайдеру используют один сохранённый `operation_key` и immutable snapshot.
4. Worker допускает at-least-once processing, а не обещает невозможную exactly-once execution.
5. `execution_version` не даёт прежнему владельцу просроченного lease перезаписать состояние нового владельца.
6. Подтверждение провайдера и обновление request/job/resource/history фиксируются одной транзакцией.
7. Финализация устанавливает сохранённый `new_expiry`; она не прибавляет 30 дней повторно.
8. Аутентификация использует opaque server-side session в HttpOnly cookie; PostgreSQL хранит только hash token, unsafe methods защищены session-bound CSRF token.
9. Роли и доступ к пространствам определяются сервером по актуальным memberships, а не полями запроса или содержимым session.
10. Срок — `DATE`/`YYYY-MM-DD`; стоимость — целое число копеек; валюта MVP — `RUB`.

Подробный failure protocol и границы гарантий описаны в [`docs/reliability.md`](./docs/reliability.md).

## План реализации

| Этап | Результат | Оценка |
|---|---|---:|
| M0 | Walking skeleton и воспроизводимый toolchain | 2 ч |
| M1 | PostgreSQL schema, seed, server-side sessions и авторизация | 7 ч |
| M2 | Заявки, transitions, history и concurrency | 5 ч |
| M3 | Provider integration, worker и recovery | 7 ч |
| M4 | Полный пользовательский интерфейс | 7 ч |
| M5 | Автоматическая приёмка API/БД/provider/UI | 6 ч |
| M6 | README, чистый запуск и финальная проверка | 3 ч |

Общий план — **37 часов**, резерв — **до 3 часов**. Задачи и Definition of Done: [`docs/roadmap.md`](./docs/roadmap.md).

## Запуск и проверка

На текущем этапе в репозитории нет `package.json`, исходного кода приложения или миграций, поэтому команды запуска API/web/worker ещё недоступны.

В ходе реализации этот раздел MUST быть заменён фактическими инструкциями:

- точные версии Node.js, pnpm, PostgreSQL и Python;
- установка зависимостей и настройка `.env`;
- запуск PostgreSQL и provider simulator;
- миграции, seed и безопасный test reset;
- запуск API, web и worker;
- тестовые учётные записи;
- команды typecheck/lint/tests;
- настройка `RENEWAL_RETRY_DELAY_MS`;
- воспроизведение recovery с остановкой приложения без перезапуска имитатора;
- получение `operation_key` и проверка `started_count=1`/`operation_count=1`;
- известные ограничения и незавершённые пункты.

Документированные команды должны соответствовать реальным package scripts и проверяться из чистого окружения.

## Правила разработки

- Сначала обновляется спецификация, затем реализация и связанные тесты.
- Изменение HTTP API синхронизируется с `docs/openapi.yaml`.
- `docs/schema.sql` является спецификацией; фактическая схема создаётся версионированными Prisma migrations.
- Изменение требований синхронизируется с traceability matrix.
- Принятый ADR заменяется новым ADR, а не переписывается незаметно.
- Обязательные P0 tests нельзя оставлять `skipped` или заменять unit tests вспомогательных функций.
- Используются только вымышленные данные и локальные секреты.

Инструкции для coding agents и дополнительные инварианты находятся в [`AGENTS.md`](./AGENTS.md).
