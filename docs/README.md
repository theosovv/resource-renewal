# Документация Resource Renewal

Документация описывает реализацию практического задания «Согласование и выполнение заявок на продление» по принципам Spec-Driven Development.

## Статус

- Базовый ориентир: MVP, рассчитанный на 24–40 часов разработки.
- Исходный документ: `../Fullstack_практическое_задание.pdf`.
- Выбранный стек: TypeScript, NestJS, React/Vite, PostgreSQL, Prisma, pnpm.
- M0 Walking skeleton реализован и проверен локально 2026-11-20: monorepo, health flow через реальную PostgreSQL, web/API shells, generated contracts, provider launch и CI workflow.
- M1 «БД, seed и доступ» реализован 2026-11-20: полная Prisma migration, повторяемый seed/reset, server-side sessions, auth endpoints, CSRF/CORS и live workspace/role guards. Локально пройдены `pnpm check`, Prisma schema/drift checks и 24 E2E с реальной PostgreSQL.
- M2 «Заявки и бизнес-переходы» реализован 2026-11-20: resource/request read API, create со snapshot и stable key, approve/reject, durable job, history и manual retry protocol. Локально пройдены `pnpm check`, Prisma validation, 22 новых M2 E2E и полный текущий набор из 46 E2E с реальной PostgreSQL, включая parallel create/approve и настоящий provider stats после reject.
- M3 «Надёжная интеграция» реализован 2026-11-21: typed provider client, persistent polling worker, claim/lease/fencing, POST/RECONCILE recovery, лимит трёх POST, attention/manual retry и однократная transactional finalization. Локально пройдены `pnpm check`, Prisma validation и 57 E2E с реальной PostgreSQL; обязательный recovery против настоящего simulator прошёл три раза подряд. Дополнительно проверены `TC-REL-012…019`; специализированные crash-boundary tests `TC-REL-006/007` остаются в remaining coverage.
- Спецификации M4–M6 остаются целевыми: основной UI, Playwright smoke и полный PDF/P0 acceptance ещё не реализованы. Актуальные команды и ограничения находятся в корневом `README.md`.

Ключевые слова **MUST**, **SHOULD**, **MAY** обозначают обязательное, рекомендуемое и необязательное требование соответственно.

## Карта документов

| Документ | Назначение |
|---|---|
| [product-spec.md](./product-spec.md) | Границы продукта, роли, функциональные требования и acceptance criteria |
| [architecture.md](./architecture.md) | Структура приложения, технологии, модули и основные контракты |
| [data-model.md](./data-model.md) | Сущности, ограничения PostgreSQL, транзакции и правила сериализации |
| [reliability.md](./reliability.md) | State machine, persistent worker, повторы, восстановление и матрица отказов |
| [openapi.yaml](./openapi.yaml) | Машинно-читаемый контракт HTTP API |
| [schema.sql](./schema.sql) | Эталонная SQL-спецификация схемы PostgreSQL |
| [test-plan.md](./test-plan.md) | Автоматические и ручные проверки, включая параллельность и перезапуск |
| [roadmap.md](./roadmap.md) | Поэтапный план реализации на 37 часов плюс до 3 часов резерва |
| [traceability-matrix.md](./traceability-matrix.md) | Связь требований, решений, задач и тестов |

## ADR

| ADR | Решение |
|---|---|
| [0001](./adr/0001-modular-monolith.md) | Модульный монолит и pnpm-monorepo |
| [0002](./adr/0002-postgresql-backed-worker.md) | PostgreSQL-backed worker вместо отдельного брокера |
| [0003](./adr/0003-provider-idempotency-and-recovery.md) | Идемпотентность провайдера и восстановление после неопределённого ответа |
| [0004](./adr/0004-concurrency-and-database-integrity.md) | Конкурентность и ограничения целостности в PostgreSQL |
| [0005](./adr/0005-authentication-and-authorization.md) | Исторический JWT/Bearer подход; заменён ADR-0007 |
| [0006](./adr/0006-date-and-money-semantics.md) | Date-only, календарные дни и minor units |
| [0007](./adr/0007-server-side-http-only-sessions.md) | Server-side HttpOnly sessions, revocation и CSRF |

## Порядок чтения

1. `product-spec.md` — что должно быть реализовано.
2. `architecture.md` и ADR — как и почему выбрано такое решение.
3. `data-model.md`, `reliability.md`, `openapi.yaml`, `schema.sql` — нормативные детали реализации.
4. `test-plan.md` и `traceability-matrix.md` — как доказывается соответствие.
5. `roadmap.md` — в каком порядке выполняется работа.

## Правила изменения спецификаций

1. Идентификаторы требований (`FR-*`), задач (`T-*`), тестов (`TC-*`) и acceptance criteria (`AC-*`) после публикации не переиспользуются.
2. Изменение поведения сначала вносится в спецификацию, затем в код и тесты.
3. При изменении требования обновляются traceability matrix и затронутые ADR.
4. Принятый ADR не переписывается для сокрытия смены решения. Создаётся новый ADR со статусом `Supersedes`/`Superseded by`.
5. `openapi.yaml` является источником истины для HTTP-контракта. Изменение endpoint без обновления контракта считается незавершённым.
6. `schema.sql` является спецификацией, а не заменой Prisma migrations. Фактическая миграция MUST сохранять описанные ограничения.
7. При расхождении приоритет источников: исходное PDF → `product-spec.md` → ADR → архитектурные документы → примеры. Расхождение MUST быть устранено явно, а не обойдено в коде.

## Definition of Done для документации

Документация готова к реализации, если:

- каждое обязательное требование PDF имеет стабильный идентификатор;
- описаны все состояния и разрешённые переходы;
- атомарность, конкурентность и восстановление имеют однозначный алгоритм;
- коды `401`, `403`, `404` и `409` разграничены;
- OpenAPI и SQL-схема согласованы с текстовой спецификацией;
- каждый критический сценарий связан с автоматическим тестом;
- план укладывается в целевой бюджет и содержит критерии готовности.
