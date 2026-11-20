# Test and Acceptance Plan

## 1. Стратегия

Основной объём проверок — integration tests через HTTP API и реальную PostgreSQL. Unit tests полезны для date-only и классификации ошибок, но НЕ считаются достаточными для бизнес-приёмки.

### Уровни

| Уровень | Что проверяет |
|---|---|
| Unit | Date arithmetic, money formatting, чистые mapping-функции |
| API + DB integration | Auth, tenant isolation, transitions, constraints, transactions, jobs |
| Provider integration | POST/GET, timeout/503, stable key, stats и recovery |
| UI smoke/E2E | Основной user flow, keyboard, ошибки, desktop/mobile |
| Manual acceptance | Точный контрольный сценарий PDF с остановкой приложения |

### Вспомогательные проверки M0

Walking skeleton имеет отдельные smoke checks, которые не заменяют P0:

- `apps/api/src/modules/health/*.spec.ts` — unit-поведение health module и сокрытие DB error details;
- `apps/web/src/app.test.tsx` — loading/success/error/retry и вызов `/api/v1/health` с credentials;
- `apps/api/test/health.e2e-spec.ts` — HTTP `GET /api/v1/health` и реальный SQL round trip в PostgreSQL, без mock Prisma;
- provider `/health` и browser smoke через Vite proxy — запуск предоставленного процесса и фактическое web→API соединение.

### Обязательный P0 suite

P0 — обязательные проверки, которые нельзя оставлять `skipped`/`todo` при сдаче:

- `TC-AUTH-001…010`, `TC-TENANT-001…004`, `TC-AUTHZ-001…003`;
- `TC-REQ-001…004`, `TC-STATE-001…007`, `TC-HIST-001`;
- `TC-REL-001…005`, `TC-REL-008…011`, `TC-REL-017`, `TC-REL-019`;
- `TC-DATA-001…005`, `TC-UI-001…006`.

`TC-REL-006…007`, `TC-REL-012…016`, `TC-REL-018` — P1 fault-injection/extended robustness tests. Они SHOULD быть реализованы при наличии времени; нереализованные P1 явно перечисляются в README и не подменяют P0.

Тесты MUST NOT использовать SQLite или mock Prisma для доказательства concurrency/transactions. Конфигурация SHOULD использовать Testcontainers или отдельный одноразовый PostgreSQL в Docker. Каждый тест получает изолированную БД/schema или явно очищает данные.

## 2. Тестовое окружение

- API запускается с тестовой БД и отдельным `CSRF_SECRET`; tests используют cookie jar и session-bound CSRF token.
- Worker можно включать/выключать через env; для большинства API tests он выключен, чтобы переходы были детерминированными.
- Recovery test включает настоящий worker и управляет жизненным циклом приложения.
- Provider simulator запускается как отдельный Python-процесс на `127.0.0.1:8091`.
- Перед каждым provider test имитатор свежий; во время recovery-сценария он НЕ перезапускается.
- Для ответов, которые штатный имитатор не может воспроизвести (серия uncertain POST, payload conflict, malformed result), используется contract-compatible fault-injection provider или управляемый HTTP proxy. Он программируется на конкретный test и не заменяет обязательный запуск `TC-REL-003/004` против настоящего имитатора.
- `RENEWAL_RETRY_DELAY_MS` в автоматическом recovery test достаточно велик, чтобы остановить приложение после первого `503` до следующего provider call.
- Перед parallel tests выполняется чистый seed; parallelism не полагается на `sleep` как доказательство блокировки.

Если порт имитатора не может быть изменён, provider tests выполняются последовательно в одном test suite, а не параллельными workers.

## 3. Матрица автоматических тестов

### Данные, вход и доступ

| ID | Сценарий | Проверки |
|---|---|---|
| `TC-AUTH-001` | Запрос без session cookie | `401`; данные не возвращаются |
| `TC-AUTH-002` | Unknown/malformed/revoked session token | `401`; cookie очищается при известной revoked/expired session; данные не возвращаются |
| `TC-AUTH-003` | Login каждого seed user | Создаётся новая session, возвращаются правильные user/memberships и CSRF token; raw session token только в Set-Cookie |
| `TC-AUTH-004` | Попытка передать role/workspace/userId в login body (M1) и create body (M2) | Unknown fields отклоняются или игнорируются без влияния; identity и права не повышаются |
| `TC-AUTH-005` | Cookie attributes, at-rest hash и restart | HttpOnly/SameSite=Lax/Path=/; Secure при `COOKIE_SECURE=true`; БД содержит только SHA-256 hash; `/auth/me` работает после API restart с той же cookie |
| `TC-AUTH-006` | Logout | CSRF-защищённый logout ставит `revoked_at`, очищает cookie; повторное использование старой cookie даёт `401`; другие sessions не отзываются |
| `TC-AUTH-007` | Idle и absolute expiry | Через test clock/короткие TTL: activity продлевает только idle expiry; idle и absolute expiry дают `401` даже до cleanup |
| `TC-AUTH-008` | CSRF на unsafe methods | Без/с неверным `X-CSRF-Token` logout/create/approve/reject/retry возвращают `403 CSRF_INVALID` без mutations; session-bound валидный token разрешает действие, token другой session не работает |
| `TC-AUTH-009` | Origin/Fetch Metadata и CORS | Cross-site login/mutation отклоняется; configured web origin принимается; CORS credentials не используют wildcard |
| `TC-AUTH-010` | Изменение user/membership после login | С прежней cookie: деактивация user → `401`; удаление workspace membership → `403`; понижение роли запрещает прежнее action; нет cached authorization grants |
| `TC-TENANT-001` | Beta user читает Alpha resources/requests по известным ID | `403` для Alpha workspace; тело не содержит Alpha data |
| `TC-TENANT-002` | Beta user approve/reject/retry Alpha request | `403`; request/job/resource/history не меняются |
| `TC-TENANT-003` | UUID другого workspace подставлен в path доступного workspace | `404`; данные другого пространства не раскрываются |
| `TC-TENANT-004` | Beta initiator создаёт заявку на Alpha resource | `403` для Alpha workspace либо `404` при подмене UUID внутри Beta; request/job/history Alpha не создаются |
| `TC-AUTHZ-001` | Initiator пытается approve/reject/retry | `403` даже в своём пространстве |
| `TC-AUTHZ-002` | Universal решает собственную заявку | Approve и reject `403 SELF_DECISION_FORBIDDEN` |
| `TC-AUTHZ-003` | Approver-only пытается создать заявку | `403`; request/job/history не создаются |

### Создание и переходы

| ID | Сценарий | Проверки |
|---|---|---|
| `TC-REQ-001` | Успешное создание на `res-a-01` | `201`, snapshot `2027-03-01 → 2027-03-31`, 128000/RUB, creator из server-side session, resource не изменён, creation event |
| `TC-REQ-002` | Последовательная вторая активная заявка | `409 REQUEST_ALREADY_ACTIVE`; в БД одна active request |
| `TC-REQ-003` | Параллельные create на один resource | Один `201`, остальные `409`; unique index, одна active request |
| `TC-REQ-004` | Заявки на разные ресурсы | Могут быть активными независимо |
| `TC-STATE-001` | Reject pending другим approver | `REJECTED`, decision metadata/history; resource не изменён, job отсутствует |
| `TC-STATE-002` | Повторный reject, approve rejected, retry rejected | `409 INVALID_STATE_TRANSITION`; provider/job отсутствуют |
| `TC-STATE-003` | Stale snapshot перед approve | Параметризовано для изменения expiry, amount и currency; approve `409`, request остаётся pending, job/provider call отсутствуют |
| `TC-STATE-004` | Параллельные approve | Два HTTP requests, один `200`, второй `409`; ровно одна job и один approval event |
| `TC-STATE-005` | Повторный approve после commit | `409`; число jobs и provider operations не растёт |
| `TC-STATE-006` | Создание после rejected/completed | Разрешено; новый snapshot соответствует текущему ресурсу |
| `TC-STATE-007` | Отклонение не вызывает provider | Для resource rejected request `operation_count=0`, expiry не изменился, других operation keys не появилось |
| `TC-HIST-001` | Полная история | Actor, timestamp, from/to статусы корректны; system actor у worker; нет secrets/full provider response |

### Provider и reliability

| ID | Сценарий | Проверки |
|---|---|---|
| `TC-REL-001` | Atomic approve | После commit одновременно существуют `PROCESSING`, одна job и history; job не создаётся при rollback |
| `TC-REL-002` | Первый POST возвращает 503 | Один POST counter, job снова `PENDING`, persisted `next_attempt_at`, lease очищен, request `PROCESSING`, resource не изменён |
| `TC-REL-003` | Recovery после 503 против настоящего имитатора | Остановить API/worker после первого POST, запустить заново с тем же DB и provider; прежний key, completed, resource `2027-03-31` |
| `TC-REL-004` | Внешняя однократность против настоящего имитатора | Provider GET: `started_count=1`; stats `operation_count=1` для resource, включая отсутствие других ключей |
| `TC-REL-005` | Повторная финализация | Повторно доставить тот же provider result/запустить due processing; expiry остаётся `2027-03-31`, нет второго completion event |
| `TC-REL-006` | Crash до первого POST | Approved job переживает restart; после запуска создаётся одна provider operation |
| `TC-REL-007` | Crash после provider 200 до finalization | Test hook останавливает приложение на границе; restart получает прежний result через GET и однократно финализирует |
| `TC-REL-008` | Три uncertain POST | Fault provider возвращает 503 и не подтверждает GET; после reconciliation request `NEEDS_ATTENTION`, job `WAITING_MANUAL`, lease пуст; ровно три POST; дальнейшие automatic claims отсутствуют |
| `TC-REL-009` | GET не считается attempt | Несколько GET не меняют POST counters |
| `TC-REL-010` | Manual retry | Approver получает `200`, request `PROCESSING`, job `PENDING/RECONCILE`, cycle counter=0, total сохранён, прежний key, active index продолжает блокировать create |
| `TC-REL-011` | Повторный/недопустимый retry | `409`; нет нового cycle/job |
| `TC-REL-012` | Provider 409 на payload conflict | Fault provider/proxy возвращает 409; атомарно `NEEDS_ATTENTION` + `WAITING_MANUAL`, lease пуст, без automatic claims/POST |
| `TC-REL-013` | Provider result mismatch | Fault provider возвращает completed с другим полем/started_count; нет finalization/resource update; guarded attention |
| `TC-REL-014` | Resource conflict перед finalization | Conditional update затрагивает 0 строк; атомарно attention + waiting job + one event + cleared lease; expiry не перезаписан |
| `TC-REL-015` | Lease recovery | RUNNING job с истёкшим lease получает новый execution version и RECONCILE; counters не увеличиваются на GET |
| `TC-REL-016` | Два worker claims | Только один владеет job одновременно; provider operation_count=1 и одна финализация |
| `TC-REL-017` | Create одновременно с finalization | Допустим только `409 REQUEST_ALREADY_ACTIVE` либо create с post-completion snapshot; stale pre-completion snapshot запрещён |
| `TC-REL-018` | Запоздалый прежний lease owner | Первый owner задержан до истечения lease, второй claim увеличивает version; результат первого не меняет scheduling/attention/finalization |
| `TC-REL-019` | Claimability после reschedule | После uncertain POST и после GET timeout/404 job имеет `PENDING`, корректные action/due time и пустой lease; при наступлении due снова выбирается |

Для crash-boundary tests SHOULD быть узкие test hooks вокруг provider client/finalization, доступные только в test environment. Hook инициирует реальный lifecycle остановки, а не вызывает private helper вместо API. P0 tests не исключаются из-за сложности fault injection. Если P1 crash/fault scenarios не укладываются во время, они явно перечисляются в README как незакрытый extended test coverage.

### Даты и деньги

| ID | Сценарий | Проверки |
|---|---|---|
| `TC-DATA-001` | `2027-03-01 + 30` | Ровно `2027-03-31` |
| `TC-DATA-002` | Месяцы разной длины/leap day | Date-only utility без timezone/DST сдвига |
| `TC-DATA-003` | Стоимость 128000 | API/provider integer 128000; UI `1 280,00 RUB`; БД BIGINT |
| `TC-DATA-004` | Повторная обработка completed | Snapshot и resource expiry не меняются |
| `TC-DATA-005` | История заявок ресурса | `GET /requests?resourceId=...` возвращает активную и terminal заявки именно этого ресурса; rejected/completed остаются доступны, чужой ресурс не попадает в выборку |

### UI

| ID | Сценарий | Проверки |
|---|---|---|
| `TC-UI-001` | Login → create → approver login → approve | Основной flow через реальные API, статусы обновляются |
| `TC-UI-002` | Loading/empty/error/409/403 | Есть понятный текст, нет бесконечного spinner или необработанного exception |
| `TC-UI-003` | Keyboard | Tab order, Enter/Space, focus-visible, labels, accessible dialog |
| `TC-UI-004` | 1440×900 | Центрированный контент, визуальная близость референса, заголовок 32 px, основной текст 14–16 px |
| `TC-UI-005` | 390 px | Нет наложений и horizontal page scroll; действия доступны |
| `TC-UI-006` | Processing/attention/completed | Статус, counters/error и history понятны пользователю |

## 4. Главный recovery test

Автоматический `TC-REL-003` MUST выполнять следующий сценарий:

1. Fresh DB + seed, fresh provider; `stats(res-a-01)=0`.
2. Initiator Alpha через API создаёт заявку.
3. Approver Alpha через API одобряет её.
4. Worker выполняет первый POST. Test ждёт persisted `total_post_attempts=1` и `next_action=RECONCILE`, а не фиксированный произвольный sleep.
5. До наступления `next_attempt_at` приложение останавливается; provider остаётся работать.
6. Приложение запускается заново с теми же `DATABASE_URL`, `PROVIDER_BASE_URL` и operation state в DB.
7. Test ждёт `COMPLETED` через public API с разумным timeout.
8. Проверяются resource expiry, job, history, provider operation key, `started_count=1` и `operation_count=1`.
9. Повторный worker pass не меняет дату и stats.

Останавливать и перезапускать PostgreSQL или provider в этом тесте запрещено: проверяется именно восстановление приложения.

## 5. Ручная приёмка по PDF

1. Запустить PostgreSQL, миграции/seed, provider, API+worker и web.
2. Для наглядности установить `RENEWAL_RETRY_DELAY_MS=60000`.
3. Войти initiator Alpha и создать заявку на Хранилище A.
4. Проверить `2027-03-01 → 2027-03-31`, неизменный текущий срок и блокировку второй заявки.
5. Отдельно проверить Beta isolation и universal self-decision.
6. Войти approver Alpha, одобрить; повторное одобрение должно вернуть `409`.
7. Дождаться первого 503 по UI/job state, остановить приложение до следующего call, затем запустить снова.
8. Дождаться `COMPLETED`, проверить срок и историю.
9. Скопировать operation key из detail и выполнить:

```bash
curl --get 'http://127.0.0.1:8091/renewals/<URL_ENCODED_OPERATION_KEY>'
curl --get 'http://127.0.0.1:8091/stats' --data-urlencode 'resource_id=res-a-01'
```

Ожидается `started_count=1` и `operation_count=1`.

10. Для другого ресурса создать и отклонить заявку: срок не меняется, а `GET /stats?resource_id=<другой_resource_id>` явно возвращает `operation_count=0`.
11. Проверить desktop/mobile, keyboard и понятные ошибки.

В итоговом README operation key должен быть доступен не только через SQL: его можно увидеть в UI detail или API response авторизованного пользователя.

## 6. Критерии выхода

- Все P0 integration tests стабильно проходят из чистого окружения одной документированной командой.
- Recovery test проходит минимум три раза подряд без ручной чистки между прогонами команды test suite.
- Нет skipped tests для обязательных acceptance criteria; если что-то не реализовано, это явно указано в README.
- OpenAPI соответствует фактическим responses; SQL constraints присутствуют в migrated test DB.
- Нет secrets и реальных данных в fixtures/logs.
- UI smoke и manual checklist выполнены; найденные ограничения задокументированы.
