import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getRequests, getResources } from '../../api/client';
import { queryKeys } from '../../api/query-keys';
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback';
import { StatusBadge } from '../../components/status-badge';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { useWorkspace } from '../workspaces/workspace-context';
import { CreateRequestDialog } from './create-request-dialog';

export function RenewalsPage() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [resourceFilter, setResourceFilter] = useState<string | null>(null);
  const requestsQuery = useQuery({
    queryKey: queryKeys.requests(workspace.id),
    queryFn: ({ signal }) => getRequests(workspace.id, signal),
    refetchInterval: (query) =>
      query.state.data?.items.some((request) => request.status === 'PROCESSING') ? 2500 : false,
  });
  const hasProcessing = requestsQuery.data?.items.some((request) => request.status === 'PROCESSING') ?? false;
  const resourcesQuery = useQuery({
    queryKey: queryKeys.resources(workspace.id),
    queryFn: ({ signal }) => getResources(workspace.id, signal),
    refetchInterval: hasProcessing ? 2500 : false,
  });
  const resources = useMemo(() => resourcesQuery.data?.items ?? [], [resourcesQuery.data]);
  const requests = useMemo(() => requestsQuery.data?.items ?? [], [requestsQuery.data]);

  const resourceById = useMemo(
    () => new Map(resources.map((resource) => [resource.id, resource])),
    [resources],
  );
  const visibleRequests = resourceFilter
    ? requests.filter((request) => request.resourceId === resourceFilter)
    : requests;
  const filteredResource = resourceFilter ? resourceById.get(resourceFilter) : undefined;
  const canCreate = workspace.roles.includes('INITIATOR');
  const hasAvailableResource = resources.some((resource) => resource.activeRequestId === null);
  const pendingCount = requests.filter((request) => request.status === 'PENDING_APPROVAL').length;
  const processingCount = requests.filter((request) => request.status === 'PROCESSING').length;
  const attentionCount = requests.filter((request) => request.status === 'NEEDS_ATTENTION').length;

  return (
    <>
      <section className="page-heading" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">Рабочее пространство: {workspace.name}</p>
          <h1 id="page-title">Заявки на продление</h1>
          <p className="page-description">
            Создавайте заявки, отслеживайте выполнение и проверяйте историю операций.
          </p>
        </div>
        <div className="page-actions">
          <button
            className="button button--secondary"
            type="button"
            disabled={resourcesQuery.isFetching || requestsQuery.isFetching}
            onClick={() => {
              void Promise.all([resourcesQuery.refetch(), requestsQuery.refetch()]);
            }}
          >
            {resourcesQuery.isFetching || requestsQuery.isFetching ? 'Обновляем…' : 'Обновить'}
          </button>
          {canCreate && (
            <button
              className="button button--primary"
              type="button"
              disabled={!resourcesQuery.data || !hasAvailableResource}
              title={!hasAvailableResource && resourcesQuery.data ? 'У всех ресурсов есть активные заявки' : undefined}
              onClick={() => setIsCreateOpen(true)}
            >
              Создать заявку
            </button>
          )}
        </div>
      </section>

      {hasProcessing && (
        <p className="live-note" role="status">
          Выполняющиеся заявки обновляются автоматически каждые 2,5 секунды.
        </p>
      )}

      <section className="card summary-card" aria-label="Сводка по заявкам">
        <dl className="counters">
          <div><dt>Всего</dt><dd>{requestsQuery.data?.total ?? '—'}</dd></div>
          <div><dt>Ожидают</dt><dd>{requestsQuery.data ? pendingCount : '—'}</dd></div>
          <div><dt>Выполняется</dt><dd>{requestsQuery.data ? processingCount : '—'}</dd></div>
          <div><dt>Требуют внимания</dt><dd>{requestsQuery.data ? attentionCount : '—'}</dd></div>
        </dl>
      </section>

      <section className="card" aria-labelledby="resources-title">
        <div className="section-heading">
          <div>
            <h2 id="resources-title">Ресурсы</h2>
            <p>Текущий срок меняется только после подтверждения операции.</p>
          </div>
        </div>
        {resourcesQuery.isPending ? (
          <LoadingState label="Загружаем ресурсы…" />
        ) : resourcesQuery.isError ? (
          <ErrorState
            error={resourcesQuery.error}
            title="Не удалось загрузить ресурсы"
            onRetry={() => void resourcesQuery.refetch()}
          />
        ) : resources.length === 0 ? (
          <EmptyState title="Ресурсов пока нет" description="В этом пространстве нет доступных ресурсов." />
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Ресурс</th>
                  <th scope="col">Срок</th>
                  <th scope="col">Стоимость</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Заявки</th>
                </tr>
              </thead>
              <tbody>
                {resources.map((resource) => {
                  const activeRequest = requests.find((request) => request.id === resource.activeRequestId);
                  return (
                    <tr key={resource.id}>
                      <td data-label="Ресурс">
                        <strong>{resource.name}</strong>
                        <span className="cell-secondary">{resource.externalId}</span>
                      </td>
                      <td data-label="Срок">{formatDate(resource.expiresOn)}</td>
                      <td data-label="Стоимость" className="numeric-cell">
                        {formatMoney(resource.amountMinor, resource.currency)}
                      </td>
                      <td data-label="Статус">
                        {resource.activeRequestId && activeRequest ? (
                          <Link className="status-link" to={`/w/${workspace.id}/renewals/${resource.activeRequestId}`}>
                            <StatusBadge status={activeRequest.status} />
                          </Link>
                        ) : resource.activeRequestId && requestsQuery.isPending ? (
                          <span className="muted">Загружаем статус…</span>
                        ) : resource.activeRequestId ? (
                          <Link className="text-link" to={`/w/${workspace.id}/renewals/${resource.activeRequestId}`}>
                            Открыть активную заявку
                          </Link>
                        ) : (
                          <span className="muted">Нет активной заявки</span>
                        )}
                      </td>
                      <td data-label="Заявки">
                        <button
                          className="button button--link"
                          type="button"
                          onClick={() => setResourceFilter(resource.id)}
                        >
                          История
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {canCreate && resourcesQuery.data && !hasAvailableResource && (
          <p className="section-note">Чтобы создать новую заявку, дождитесь завершения или отклонения активной.</p>
        )}
      </section>

      <section className="card" aria-labelledby="requests-title">
        <div className="section-heading">
          <div>
            <h2 id="requests-title">Заявки</h2>
            <p>{filteredResource ? `История ресурса ${filteredResource.name}` : 'Активные и завершённые заявки пространства.'}</p>
          </div>
          {resourceFilter && (
            <button className="button button--secondary" type="button" onClick={() => setResourceFilter(null)}>
              Показать все
            </button>
          )}
        </div>
        {requestsQuery.isPending ? (
          <LoadingState label="Загружаем заявки…" />
        ) : requestsQuery.isError ? (
          <ErrorState
            error={requestsQuery.error}
            title="Не удалось загрузить заявки"
            onRetry={() => void requestsQuery.refetch()}
          />
        ) : visibleRequests.length === 0 ? (
          <EmptyState
            title={resourceFilter ? 'Для ресурса пока нет заявок' : 'Заявок пока нет'}
            description={canCreate ? 'Создайте первую заявку из доступного ресурса.' : 'Новые заявки появятся здесь после создания инициатором.'}
          />
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Ресурс</th>
                  <th scope="col">Продление</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Создана</th>
                  <th scope="col"><span className="visually-hidden">Действие</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleRequests.map((request) => (
                  <tr key={request.id}>
                    <td data-label="Ресурс">
                      <strong>{resourceById.get(request.resourceId)?.name ?? 'Ресурс заявки'}</strong>
                      <span className="cell-secondary">{formatMoney(request.snapshot.amountMinor, request.snapshot.currency)}</span>
                    </td>
                    <td data-label="Продление">
                      <span>{formatDate(request.snapshot.oldExpiry)} <span aria-hidden="true">→</span> {formatDate(request.snapshot.newExpiry)}</span>
                    </td>
                    <td data-label="Статус"><StatusBadge status={request.status} /></td>
                    <td data-label="Создана">{formatDateTime(request.createdAt)}</td>
                    <td data-label="Действие">
                      <Link className="text-link" to={`/w/${workspace.id}/renewals/${request.id}`}>Подробнее</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isCreateOpen && resourcesQuery.data && (
        <CreateRequestDialog
          workspaceId={workspace.id}
          resources={resources}
          onClose={() => setIsCreateOpen(false)}
          onCreated={(request) => {
            setIsCreateOpen(false);
            void navigate(`/w/${workspace.id}/renewals/${request.id}`);
          }}
        />
      )}
    </>
  );
}
