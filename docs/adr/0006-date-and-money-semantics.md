# ADR-0006: Date-only, календарные дни и minor units

- Статус: Accepted
- Дата: 2026-11-20

## Контекст

Срок задан как календарная дата, а продление всегда равно 30 календарным дням от прежнего срока. Использование local timezone или milliseconds может дать другой день. Стоимость задана целым числом копеек, а не decimal major units.

## Решение

### Даты

- В PostgreSQL использовать `DATE`.
- В OpenAPI/JSON использовать `YYYY-MM-DD` (`format: date`).
- В UI отображать `DD.MM.YYYY` без изменения значения.
- При расчёте интерпретировать компоненты даты как UTC и использовать UTC-арифметику либо отдельную проверенную date-only utility.
- Запретить `new Date('YYYY-MM-DD').toLocale...` как неявный механизм бизнес-расчёта без явного UTC-контроля.
- `new_expiry` вычисляется один раз при создании; finalize просто устанавливает сохранённое значение.
- В БД дополнительно действует `CHECK (new_expiry = old_expiry + 30)`.

### Деньги

- В PostgreSQL использовать `BIGINT amount_minor` с nonnegative check.
- В API/provider передавать JSON integer копеек, не рубли и не floating point.
- В UI форматировать `128000` как `1 280,00 RUB` через `Intl.NumberFormat('ru-RU', ...)` после безопасного преобразования.
- Prisma `bigint` преобразуется в JSON number только после `Number.isSafeInteger` проверки.
- Валюта в MVP — `RUB`; provider period — ровно `1`.

## Последствия

- `2027-03-01 + 30 days = 2027-03-31` независимо от timezone и DST.
- Повторный finalize не прибавляет дни повторно.
- Нет floating-point ошибок стоимости.
- Появляется небольшой serialization adapter для `bigint`.

## Альтернативы

- **`TIMESTAMPTZ` для срока:** отклонено, добавляет timezone там, где домен использует date-only.
- **Floating-point рубли:** отклонено из-за точности и несоответствия заданию.
- **Повторное `current_expiry + 30` при каждом finalize:** отклонено, нарушает однократность продления.
- **JSON string для bigint:** допустимо в общем случае, но не выбрано, поскольку provider contract ожидает число, а тестовые значения безопасны.
