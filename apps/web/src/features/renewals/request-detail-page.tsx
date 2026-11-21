import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getRequestDetail, type RenewalRequestDetail } from '../../api/client';
import { getProviderErrorMessage } from '../../api/error-messages';
import { queryKeys } from '../../api/query-keys';
import { ErrorState, LoadingState } from '../../components/feedback';
import { StatusBadge } from '../../components/status-badge';
import { useAuth } from '../auth/auth-context';
import { useWorkspace } from '../workspaces/workspace-context';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  jobStatusLabels,
  requestStatusLabels,
} from '../../lib/format';
import { RequestActions } from './request-actions';

export function RequestDetailPage() {
  const { requestId = '' } = useParams();
  const workspace = useWorkspace();
  const { user } = useAuth();
  const [copyStatus, setCopyStatus] = useState('');
  const detailQuery = useQuery({
    queryKey: queryKeys.request(workspace.id, requestId),
    queryFn: ({ signal }) => getRequestDetail(workspace.id, requestId, signal),
    enabled: requestId.length > 0,
    refetchInterval: (query) => query.state.data?.status === 'PROCESSING' ? 2500 : false,
  });

  if (!requestId) {
    return <ErrorState error={null} title="Заявка не найдена" />;
  }
  if (detailQuery.isPending) {
    return <LoadingState label="Загружаем заявку и историю…" />;
  }
  if (detailQuery.isError) {
    return (
      <>
        <BackLink workspaceId={workspace.id} />
        <ErrorState
          error={detailQuery.error}
          title="Не удалось загрузить заявку"
          onRetry={() => void detailQuery.refetch()}
        />
      </>
    );
  }

  const request: RenewalRequestDetail = detailQuery.data;

  return (
    <>
      <BackLink workspaceId={workspace.id} />
      <section className="page-heading detail-heading" aria-labelledby="request-title">
        <div>
          <p className="eyebrow">{request.resource.name} · {request.resource.externalId}</p>
          <h1 id="request-title">Заявка на продление</h1>
          <p className="page-description">Создана {formatDateTime(request.createdAt)}</p>
        </div>
        <StatusBadge status={request.status} />
      </section>

      {request.status === 'PROCESSING' && (
        <p className="live-note" role="status">Статус и execution state обновляются автоматически каждые 2,5 секунды.</p>
      )}
      {request.status === 'NEEDS_ATTENTION' && (
        <div className="attention-banner" role="alert">
          <strong>Автоматическая обработка остановлена</strong>
          <p>Проверьте execution state. Согласующий может повторить сверку с тем же ключом операции.</p>
        </div>
      )}

      <div className="detail-grid">
        <section className="card detail-card" aria-labelledby="snapshot-title">
          <div className="section-heading">
            <div><h2 id="snapshot-title">Снимок заявки</h2><p>Эти значения не меняются при retry.</p></div>
          </div>
          <dl className="detail-list">
            <div><dt>Ресурс</dt><dd>{request.resource.name} <span className="cell-secondary">{request.resource.externalId}</span></dd></div>
            <div><dt>Текущий срок ресурса</dt><dd>{formatDate(request.resource.expiresOn)}</dd></div>
            <div><dt>Срок до продления</dt><dd>{formatDate(request.snapshot.oldExpiry)}</dd></div>
            <div><dt>Новый срок</dt><dd><strong>{formatDate(request.snapshot.newExpiry)}</strong></dd></div>
            <div><dt>Стоимость</dt><dd>{formatMoney(request.snapshot.amountMinor, request.snapshot.currency)}</dd></div>
            <div><dt>Период</dt><dd>30 календарных дней</dd></div>
          </dl>
        </section>

        <section className="card detail-card" aria-labelledby="execution-title">
          <div className="section-heading">
            <div><h2 id="execution-title">Выполнение</h2><p>Состояние persistent job и попытки POST.</p></div>
          </div>
          {request.execution ? (
            <dl className="detail-list">
              <div><dt>Состояние задачи</dt><dd>{jobStatusLabels[request.execution.status]}</dd></div>
              <div><dt>Попытки POST в цикле</dt><dd>{request.execution.attemptsInCycle} из 3</dd></div>
              <div><dt>Всего попыток POST</dt><dd>{request.execution.totalPostAttempts}</dd></div>
              <div><dt>Следующее действие не ранее</dt><dd>{formatDateTime(request.execution.nextAttemptAt)}</dd></div>
              {request.execution.lastErrorCode && (
                <div className="detail-list__error">
                  <dt>Последняя ошибка</dt>
                  <dd>
                    {getProviderErrorMessage(request.execution.lastErrorCode)}
                    <code className="safe-code">{request.execution.lastErrorCode}</code>
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <div className="execution-empty">
              <p>Фоновая задача ещё не создана. Она появится атомарно с согласованием заявки.</p>
            </div>
          )}
          <RequestActions workspace={workspace} request={request} currentUserId={user?.id ?? ''} />
        </section>
      </div>

      <section className="card" aria-labelledby="operation-title">
        <div className="section-heading">
          <div><h2 id="operation-title">Операция провайдера</h2><p>Ключ нужен для проверки recovery и started_count в simulator.</p></div>
        </div>
        <dl className="detail-list operation-list">
          <div>
            <dt>Operation key</dt>
            <dd className="operation-key-row">
              <code className="operation-value">{request.operationKey}</code>
              <button
                className="button button--secondary button--small"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(request.operationKey);
                    setCopyStatus('Ключ скопирован.');
                  } catch {
                    setCopyStatus('Не удалось скопировать автоматически. Выделите ключ вручную.');
                  }
                }}
              >
                Копировать ключ
              </button>
            </dd>
          </div>
          <div><dt>Provider operation ID</dt><dd>{request.providerOperationId ? <code className="operation-value">{request.providerOperationId}</code> : 'Появится после подтверждения провайдера'}</dd></div>
          <div><dt>Завершена</dt><dd>{formatDateTime(request.completedAt)}</dd></div>
        </dl>
        <span className="visually-live" role="status" aria-live="polite">{copyStatus}</span>
      </section>

      <section className="card" aria-labelledby="history-title">
        <div className="section-heading">
          <div><h2 id="history-title">История</h2><p>Пользовательские и системные переходы заявки.</p></div>
        </div>
        <ol className="history-list">
          {request.history.map((event) => (
            <li key={event.id} className="history-event">
              <span className={`history-marker history-marker--${event.actorType.toLowerCase()}`} aria-hidden="true" />
              <div className="history-event__content">
                <div className="history-event__heading">
                  <strong>{event.fromStatus ? `${requestStatusLabels[event.fromStatus]} → ${requestStatusLabels[event.toStatus]}` : `Создана · ${requestStatusLabels[event.toStatus]}`}</strong>
                  <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                </div>
                <p>{event.actorType === 'SYSTEM' ? 'Система · worker' : event.actorDisplayName ?? 'Пользователь'}</p>
                {event.reasonCode && (
                  <div className="history-reason">
                    <span>{getProviderErrorMessage(event.reasonCode)}</span>
                    <code className="safe-code">{event.reasonCode}</code>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function BackLink({ workspaceId }: { workspaceId: string }) {
  return <Link className="back-link" to={`/w/${workspaceId}/renewals`}>← Все ресурсы и заявки</Link>;
}
