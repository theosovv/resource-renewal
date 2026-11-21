import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ApiError,
  performRequestAction,
  type RenewalRequestDetail,
  type RequestAction,
  type Workspace,
} from '../../api/client';
import { getErrorMessage } from '../../api/error-messages';
import { queryKeys } from '../../api/query-keys';
import { ModalDialog } from '../../components/modal-dialog';

const actionContent: Record<
  RequestAction,
  { title: string; description: string; confirmLabel: string; pendingLabel: string }
> = {
  approve: {
    title: 'Согласовать заявку?',
    description: 'Будет создана фоновая задача с неизменяемым снимком. Срок ресурса изменится только после подтверждения провайдера.',
    confirmLabel: 'Согласовать',
    pendingLabel: 'Согласовываем…',
  },
  reject: {
    title: 'Отклонить заявку?',
    description: 'Заявка завершится без обращения к провайдеру и без изменения ресурса. Это решение нельзя отменить.',
    confirmLabel: 'Отклонить',
    pendingLabel: 'Отклоняем…',
  },
  retry: {
    title: 'Повторить обработку?',
    description: 'Worker сначала проверит результат у провайдера по прежнему ключу операции. Новая внешняя операция без необходимости не создаётся.',
    confirmLabel: 'Повторить обработку',
    pendingLabel: 'Запускаем повтор…',
  },
};

export function RequestActions({
  workspace,
  request,
  currentUserId,
}: {
  workspace: Workspace;
  request: RenewalRequestDetail;
  currentUserId: string;
}) {
  const queryClient = useQueryClient();
  const [selectedAction, setSelectedAction] = useState<RequestAction | null>(null);
  const isApprover = workspace.roles.includes('APPROVER');
  const isOwnPendingRequest = request.status === 'PENDING_APPROVAL' && request.createdBy === currentUserId;
  const canDecide = isApprover && request.status === 'PENDING_APPROVAL' && !isOwnPendingRequest;
  const canRetry = isApprover && request.status === 'NEEDS_ATTENTION';

  const mutation = useMutation({
    mutationFn: (action: RequestAction) => performRequestAction(workspace.id, request.id, action),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.request(workspace.id, request.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.requests(workspace.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.resources(workspace.id) }),
      ]);
      setSelectedAction(null);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.request(workspace.id, request.id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.requests(workspace.id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.resources(workspace.id) });
      }
    },
  });

  if (!canDecide && !canRetry) {
    if (isApprover && isOwnPendingRequest) {
      return <p className="inline-notice">Собственную заявку нельзя согласовать или отклонить. Нужен другой approver.</p>;
    }
    if (!isApprover && request.status === 'PENDING_APPROVAL') {
      return <p className="inline-notice">Заявка ожидает решения согласующего.</p>;
    }
    return null;
  }

  const content = selectedAction ? actionContent[selectedAction] : null;

  return (
    <div className="request-actions" aria-label="Действия с заявкой">
      {canDecide && (
        <>
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              mutation.reset();
              setSelectedAction('approve');
            }}
          >
            Согласовать
          </button>
          <button
            className="button button--danger"
            type="button"
            onClick={() => {
              mutation.reset();
              setSelectedAction('reject');
            }}
          >
            Отклонить
          </button>
        </>
      )}
      {canRetry && (
        <button
          className="button button--primary"
          type="button"
          onClick={() => {
            mutation.reset();
            setSelectedAction('retry');
          }}
        >
          Повторить обработку
        </button>
      )}

      {selectedAction && content && (
        <ModalDialog
          title={content.title}
          description={content.description}
          onClose={() => {
            if (!mutation.isPending) {
              setSelectedAction(null);
              mutation.reset();
            }
          }}
        >
          {mutation.isError && (
            <div className="inline-error" role="alert">{getErrorMessage(mutation.error)}</div>
          )}
          <div className="dialog-actions">
            <button
              className="button button--secondary"
              type="button"
              data-dialog-initial-focus
              autoFocus
              disabled={mutation.isPending}
              onClick={() => {
                setSelectedAction(null);
                mutation.reset();
              }}
            >
              Отмена
            </button>
            <button
              className={`button ${selectedAction === 'reject' ? 'button--danger' : 'button--primary'}`}
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(selectedAction)}
            >
              {mutation.isPending ? content.pendingLabel : content.confirmLabel}
            </button>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
