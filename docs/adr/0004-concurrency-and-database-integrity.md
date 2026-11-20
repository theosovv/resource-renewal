# ADR-0004: Конкурентность и целостность через PostgreSQL

- Статус: Accepted
- Дата: 2026-11-20

## Контекст

Предварительные проверки в приложении не защищают от параллельных create/approve. Требования запрещают две активные заявки, две jobs после параллельных approvals и повторное изменение срока.

## Решение

Использовать несколько независимых уровней защиты:

1. Частичный unique index на `resource_id` для активных request statuses.
2. Unique `renewal_jobs.request_id`, `operation_key` и `provider_operation_id`.
3. Row locks с повторной проверкой состояния для approve/reject/retry/finalize.
4. Составной FK `(resource_id, workspace_id)` для tenant consistency.
5. Conditional update resource по старому snapshot при финализации.
6. Resource lock перед чтением snapshot при create, чтобы исключить гонку create/finalize.
7. Порядок locks: request → job → resource, когда участвуют все сущности; approve использует request → resource до создания новой job, create удерживает только resource lock.
8. Монотонный `execution_version` как fencing token для каждой записи результата worker.
9. SQL `23505` и invalid state mapping в предсказуемые `409`, self-decision — в `403`.

## Последствия

- Корректность не зависит от количества API instances.
- Нужны parameterized raw SQL и integration tests с реальной PostgreSQL; SQLite/in-memory DB не подходят для проверки.
- Неверный порядок блокировок может создать deadlocks; порядок фиксируется как часть контракта реализации.
- Unique violation требует точного сопоставления constraint name, чтобы не маскировать другие ошибки БД.

## Альтернативы

- **Проверка `SELECT` перед insert:** отклонена из-за race condition.
- **Только optimistic UI disable:** не является защитой.
- **Глобальная блокировка процесса:** не работает при нескольких instances и при перезапуске.
- **Serializable isolation для всех запросов:** избыточно; применяются точечные locks и constraints с меньшей сложностью.
