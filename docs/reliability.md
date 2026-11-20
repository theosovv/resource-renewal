# Reliability and Recovery Specification

## 1. Гарантии и их границы

Система предоставляет:

- **атомарное согласование:** request, job и history сохраняются вместе;
- **at-least-once processing:** durable job может быть взята в работу повторно;
- **одну внешнюю операцию в рамках провайдера:** благодаря стабильному `Idempotency-Key`;
- **однократную финализацию в БД:** благодаря транзакции, fencing и установке зафиксированной даты;
- **восстановление после остановки приложения:** вся необходимая информация находится в PostgreSQL.

Система НЕ обещает exactly-once execution worker и отсутствие повторного эффекта для произвольного API без идемпотентности. Отказ или перезапуск самого имитатора во время сценария не входит в гарантию.

## 2. Инварианты

1. Нет успешного согласования без committed job.
2. Нет provider call для `PENDING_APPROVAL` или `REJECTED`.
3. Все provider calls одной заявки используют один `operation_key` и одинаковые бизнес-поля payload.
4. POST-attempt резервируется в БД **до** HTTP-запроса, чтобы сбой не приводил к занижению счётчика.
5. GET никогда не увеличивает POST counters.
6. Не более трёх автоматических POST в одном execution cycle; ручной retry начинает новый cycle.
7. Каждая запись результата worker проверяет `execution_version` своего claim; результат старого владельца отбрасывается.
8. Только подтверждённый и проверенный provider result разрешает финализацию.
9. Финализация допускается только из request `PROCESSING` и job `RUNNING` текущего владельца. Из `NEEDS_ATTENTION` сначала требуется manual retry.
10. Обновление ресурса использует `new_expiry` из snapshot, а не `CURRENT_DATE` и не повторное сложение.
11. `COMPLETED` — терминальное состояние; повторная обработка не меняет resource expiry.
12. Любой переход в `NEEDS_ATTENTION` одновременно переводит job в `WAITING_MANUAL`, очищает lease и запрещает автоматический claim до manual retry.
13. Активная заявка блокирует создание другой заявки на ресурс, включая `NEEDS_ATTENTION`.

## 3. Durable job

### 3.1 Поля выполнения

| Поле | Назначение |
|---|---|
| `request_id` | Уникальная связь с заявкой |
| `status` | `PENDING`, `RUNNING`, `WAITING_MANUAL`, `SUCCEEDED` |
| `next_action` | `POST` или `RECONCILE` |
| `attempts_in_cycle` | Зарезервированные POST с последнего ручного retry |
| `total_post_attempts` | Все зарезервированные POST заявки |
| `next_attempt_at` | Самое раннее время следующего действия |
| `execution_version` | Монотонный fencing token; увеличивается при каждом claim |
| `lease_owner`, `lease_expires_at` | ID worker instance и срок владения |
| `last_error_code` | Только безопасный машинный код, без тела ответа |

`lease_owner` сам по себе не является fencing token: тот же процесс может повторно забрать просроченную job. Уникальность владения определяется возвращённым при claim значением `execution_version`.

### 3.2 Claim transaction

Worker ищет:

- `PENDING` задачи с `next_attempt_at <= now()`;
- просроченные `RUNNING` задачи с `lease_expires_at <= now()`.

Claim выполняется короткой транзакцией с row lock; конкурентные workers используют `FOR UPDATE SKIP LOCKED` или эквивалентный conditional update.

В одной claim transaction:

1. Повторно проверить due/expired условие после блокировки.
2. Увеличить `execution_version` на 1.
3. Установить `RUNNING`, `lease_owner` и новый `lease_expires_at`.
4. Для просроченной `RUNNING` установить `next_action=RECONCILE`: прежний HTTP-запрос мог достичь провайдера.
5. Если полученное `next_action=POST`, увеличить оба POST counters до HTTP.
6. Commit и вернуть snapshot payload, action и `execution_version` текущего claim.

Lease MUST превышать provider timeout и ожидаемое время короткой DB finalization. Для MVP heartbeat не требуется. Транзакция БД MUST NOT оставаться открытой во время HTTP-запроса.

### 3.3 Guarded result write

Каждый scheduling/attention/finalization write после HTTP выполняется в новой транзакции:

1. Заблокировать request, затем job; resource при финализации блокируется третьим.
2. Повторно прочитать состояние.
3. Для продолжения обработки требуются request `PROCESSING`, job `RUNNING` и `job.execution_version = version_claim`.
4. При несовпадении version/status результат считается stale и отбрасывается без изменений. Текущий владелец выполнит собственный RECONCILE.
5. Только после guard разрешены reschedule, attention или finalize.

Это предотвращает запись результата старым worker после истечения lease и назначения job новому владельцу.

### 3.4 Reschedule transaction

Любая отложенная обработка MUST атомарно установить:

```text
request.status = PROCESSING (не меняется)
job.status = PENDING
job.next_action = POST или RECONCILE
job.next_attempt_at = рассчитанное persisted время
job.lease_owner = NULL
job.lease_expires_at = NULL
job.last_error_code = safe code или NULL
```

`RUNNING` с очищенным lease не используется для ожидания. После commit задача снова claimable при наступлении `next_attempt_at`.

## 4. Протокол выполнения

### 4.1 Начало

После approve создаётся job:

```text
status=PENDING
next_action=POST
attempts_in_cycle=0
total_post_attempts=0
execution_version=0
next_attempt_at=now()
```

Первый POST выполняется без предварительного GET: ключ новый, лишний запрос не нужен.

### 4.2 RECONCILE

Worker вызывает:

```http
GET /renewals/{encodeURIComponent(operation_key)}
```

| Результат GET | `attempts_in_cycle < 3` | `attempts_in_cycle = 3` |
|---|---|---|
| `200`, валидный completed result | Финализация текущим владельцем | Финализация текущим владельцем |
| `404` | Reschedule `POST` на `now()` | Guarded attention |
| Timeout/network/5xx | Reschedule `POST` на `now()+retry_delay` | Guarded attention |
| `200`, результат невалиден/конфликтует | Guarded attention | Guarded attention |
| Другой неповторяемый ответ | Guarded attention | Guarded attention |

Если worker упал во время GET, просроченный lease с новым `execution_version` снова приводит к RECONCILE. Это не расходует POST-attempt.

### 4.3 POST

Worker отправляет:

```http
POST /renewals
Idempotency-Key: <operation_key>
Content-Type: application/json
```

```json
{
  "resource_id": "res-a-01",
  "period_months": 1,
  "amount_minor": 128000,
  "currency": "RUB"
}
```

Все значения берутся из request snapshot и связанного неизменяемого `external_id`; текущие значение и срок ресурса для retry не используются.

| Результат POST | Действие текущего владельца |
|---|---|
| `200`, валидный completed result | Немедленная финализация |
| `503`, timeout, network error, другой temporary 5xx | Reschedule `PENDING/RECONCILE` на `now()+retry_delay`, lease очищен |
| `409` от провайдера | Guarded attention `PROVIDER_PAYLOAD_CONFLICT`; автоматический POST запрещён |
| Другой ожидаемо неповторяемый 4xx | Guarded attention; не повторять идентичный запрос автоматически |

После третьего uncertain POST планируется один RECONCILE. Если GET не подтверждает операцию, выполняется guarded attention. Четвёртого автоматического POST нет.

Crash после reservation может conservatively расходовать попытку, даже если запрос фактически не ушёл. Это допустимый trade-off: возможен более ранний attention, но не потеря счётчика и скрытое превышение лимита.

### 4.4 Проверка provider result

Перед финализацией проверяются:

- `status = completed`;
- `started_count = 1`;
- непустой `operation_id`;
- `resource_id`, `period_months`, `amount_minor`, `currency` совпадают с immutable payload;
- provider result относится к запрошенному operation key.

При mismatch выполняется guarded attention с безопасным reason code. Полный ответ не логируется.

## 5. Guarded attention

Все пути в `NEEDS_ATTENTION` используют один сервисный переход:

1. Lock request → job.
2. Если request уже `COMPLETED`, не перезаписывать успех и завершить как no-op.
3. Иначе проверить request `PROCESSING`, job `RUNNING` и текущий `execution_version`. При несовпадении отбросить stale result.
4. Установить request `NEEDS_ATTENTION`.
5. Установить job `WAITING_MANUAL`, очистить lease, сохранить safe `last_error_code`.
6. Добавить ровно одно system history event с `from_status=PROCESSING` и reason code.
7. Commit всю операцию атомарно.

После этого due-job query не выбирает job. Повторная/запоздалая попытка attention не создаёт второй event и не перезаписывает `COMPLETED`.

## 6. Финализация

В одной транзакции:

1. Заблокировать request → job → resource.
2. Если request уже `COMPLETED` и сохранён тот же `provider_operation_id`, завершить как no-op.
3. Иначе проверить request `PROCESSING`, job `RUNNING` и соответствие `execution_version` текущему claim. Из `NEEDS_ATTENTION` прямая финализация запрещена.
4. Проверить operation key и provider result.
5. Выполнить один conditional `UPDATE resources SET expires_on=request.new_expiry ... WHERE id=... AND expires_on=old_expiry AND amount_minor=snapshot.amount_minor AND currency=snapshot.currency`. Не вычислять `resource.expires_on + 30`.
6. При успешном обновлении ровно одной строки сохранить provider operation ID, request `COMPLETED`, job `SUCCEEDED`, очистить lease, timestamps и history.
7. Commit.

Если conditional update затрагивает ноль строк, resource не изменён. В той же транзакции request переводится в `NEEDS_ATTENTION`, job — в `WAITING_MANUAL`, lease очищается и добавляется history `RESOURCE_CHANGED_BEFORE_FINALIZE`. Никакие success-поля не сохраняются. Поскольку request/job уже заблокированы и проверены, отдельная незащищённая attention transaction не требуется.

Уникальность `provider_operation_id` запрещает связать один provider result с двумя заявками. Если request уже `COMPLETED` с другим operation ID, состояние не перезаписывается; фиксируется только безопасный diagnostic log.

## 7. Manual retry

Endpoint доступен approver только для `NEEDS_ATTENTION`.

В одной транзакции:

1. Заблокировать request → job.
2. Повторно проверить статус request и `WAITING_MANUAL` job.
3. Перевести request в `PROCESSING`.
4. Установить job `PENDING`, `next_action=RECONCILE`, `attempts_in_cycle=0`, `next_attempt_at=now()`; очистить lease.
5. `total_post_attempts` не сбрасывать. Следующий claim увеличит `execution_version`, поэтому прежние owners не смогут записать результат.
6. Добавить history `NEEDS_ATTENTION → PROCESSING` с actor текущего approver.

Если заявка уже завершена или retry выполнен параллельно, повторный запрос возвращает `409`.

## 8. Create против финализации

Create request блокирует resource row **до чтения snapshot** и удерживает lock до insert request/history и commit.

Возможны только корректные исходы:

- active request ещё существует — insert получает unique conflict `409`;
- финализация завершилась до lock — create читает новый expiry;
- create получил lock до финализации — active index не даёт создать вторую request, а финализация продолжает после освобождения resource lock.

Недопустим исход, когда create читает старую дату, финализация завершается, а затем create вставляет stale snapshot. После ожидания lock resource обязательно перечитывается внутри той же транзакции.

## 9. Матрица отказов

| Точка отказа | Состояние после рестарта | Recovery |
|---|---|---|
| До commit approve | Нет ни нового статуса, ни job | Клиент повторяет approve; нет частичного перехода |
| После commit approve, до claim | `PROCESSING`, `PENDING` job | Worker видит due job |
| После reservation POST, до HTTP | Attempt зарезервирован | Lease recovery + новый version → GET; при `404` POST тем же ключом |
| Во время POST, provider не выполнил операцию | Attempt зарезервирован | GET `404`, затем POST тем же ключом |
| Во время POST, provider выполнил операцию | Локального результата нет | GET возвращает прежний operation |
| После `503`, до следующего действия | Сохранены `PENDING`, delay и `RECONCILE` | После запуска due job выполняет GET |
| После provider `200`, до DB finalization | Provider completed, request processing | Новый owner получает прежний result через GET и финализирует |
| Во время DB finalization | Transaction committed либо полностью rollback | No-op либо повторная финализация текущим owner |
| Lease истёк, старый worker позже вернул результат | Job принадлежит новому `execution_version` | Запись старого worker отброшена fencing guard |
| После `NEEDS_ATTENTION` | Job `WAITING_MANUAL`, lease пуст | Автоматических POST нет до manual retry; recovery/reconciliation GET не запускается |
| Worker упал, API остался жив | Недопустимое скрытое состояние | Fatal worker error завершает процесс либо supervisor перезапускает worker; heartbeat SHOULD контролироваться |

Если процесс не перезапущен, обработка не продолжается, но данные не теряются. Потеря всей PostgreSQL вместе с резервными копиями находится вне границ MVP.

## 10. Конкурентные сценарии

- **Два approve:** request lock + повторная проверка `PENDING_APPROVAL`; один переход, второй получает `409`.
- **Два create:** resource lock сериализует snapshot, а partial unique index окончательно допускает одну active request.
- **Create против finalize:** resource lock и active index исключают stale snapshot; см. раздел 8.
- **Два worker:** claim lock выбирает одного владельца; `execution_version` блокирует записи прежнего владельца после lease expiry.
- **Retry против late finalization:** request/job locks и guarded state checks; retry после `COMPLETED` возвращает `409`, stale completion отбрасывается.
- **Attention против completion:** оба guarded transitions проверяют request/job/version под locks. Поздний attention не перезаписывает `COMPLETED`.

## 11. История и логи

History отражает бизнес/state transitions:

- создание: `from_status=NULL`, actor=user;
- approve/reject/manual retry: actor=user;
- completion/attention: actor=system, safe `reason_code` при необходимости.

Технические попытки видны через counters и `last_error_code`, но не создают business transition после каждого HTTP. Logs содержат только request ID, job ID, execution version, operation key при необходимости отладки, HTTP status/category, attempt number и timing. Они MUST NOT содержать Authorization, cookies, raw session/CSRF tokens, passwords, provider response body или secrets.
