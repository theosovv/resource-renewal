import { ApiError } from './client';

const messagesByCode: Record<string, string> = {
  VALIDATION_ERROR: 'Проверьте заполненные поля и повторите действие.',
  UNAUTHORIZED: 'Сессия недействительна или истекла. Войдите снова.',
  FORBIDDEN: 'У вас нет доступа к этому пространству или действию.',
  CSRF_INVALID: 'Не удалось подтвердить защитный токен. Обновите страницу и повторите действие.',
  CSRF_REFRESHED: 'Защитный токен обновлён. Повторите действие ещё раз.',
  SELF_DECISION_FORBIDDEN: 'Нельзя согласовывать или отклонять собственную заявку.',
  RESOURCE_NOT_FOUND: 'Ресурс не найден в выбранном пространстве.',
  REQUEST_NOT_FOUND: 'Заявка не найдена в выбранном пространстве.',
  REQUEST_ALREADY_ACTIVE: 'У ресурса уже есть активная заявка. Откройте её в списке ресурсов.',
  INVALID_STATE_TRANSITION: 'Состояние заявки уже изменилось. Данные обновлены, повторять действие не нужно.',
  RESOURCE_SNAPSHOT_MISMATCH: 'Срок или стоимость ресурса изменились после создания заявки. Согласование остановлено.',
  NETWORK_ERROR: 'Не удалось связаться с API. Проверьте, что сервер запущен, и повторите попытку.',
  INVALID_RESPONSE: 'API вернул неожиданный ответ. Повторите попытку или проверьте версию сервера.',
  INTERNAL_ERROR: 'На сервере произошла ошибка. Повторите попытку позже.',
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return messagesByCode[error.code] ?? 'Действие не выполнено. Попробуйте ещё раз.';
  }
  return 'Произошла непредвиденная ошибка. Попробуйте ещё раз.';
}

export function getProviderErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    PROVIDER_UNCERTAIN: 'Провайдер не подтвердил результат. Worker сверит операцию по прежнему ключу.',
    PROVIDER_NOT_FOUND: 'Операция ещё не найдена у провайдера. Worker продолжит сверку.',
    PROVIDER_PAYLOAD_CONFLICT: 'Провайдер отклонил изменённые данные для этого ключа операции.',
    PROVIDER_NON_RETRYABLE: 'Провайдер вернул неповторяемую ошибку.',
    PROVIDER_RESULT_MISMATCH: 'Ответ провайдера не совпал с неизменяемым снимком заявки.',
    PROVIDER_PAYLOAD_INVALID: 'Данные заявки не прошли проверку перед отправкой провайдеру.',
    RESOURCE_CHANGED_BEFORE_FINALIZE: 'Ресурс изменился перед завершением, поэтому срок не был перезаписан.',
    PROVIDER_OPERATION_CONFLICT: 'Идентификатор операции уже связан с другой заявкой.',
  };
  return messages[code] ?? 'Обработка остановлена с безопасным кодом ошибки.';
}
