import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { createRequest, ApiError, type RenewalRequest, type Resource } from '../../api/client';
import { getErrorMessage } from '../../api/error-messages';
import { queryKeys } from '../../api/query-keys';
import { ModalDialog } from '../../components/modal-dialog';
import { addCalendarDays, formatDate, formatMoney } from '../../lib/format';

interface CreateRequestForm {
  resourceId: string;
}

export function CreateRequestDialog({
  workspaceId,
  resources,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  resources: Resource[];
  onClose: () => void;
  onCreated: (request: RenewalRequest) => void;
}) {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const availableResources = resources.filter((resource) => resource.activeRequestId === null);
  const firstResourceId = availableResources[0]?.id ?? '';
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<CreateRequestForm>({ defaultValues: { resourceId: firstResourceId } });
  const selectedResourceId = useWatch({ control, name: 'resourceId' });
  const selectedResource = resources.find((resource) => resource.id === selectedResourceId);

  const mutation = useMutation({
    mutationFn: (resourceId: string) => createRequest(workspaceId, resourceId),
    onSuccess: async (request) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.resources(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.requests(workspaceId) }),
      ]);
      onCreated(request);
    },
    onError: (error) => {
      setSubmitError(error);
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.resources(workspaceId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.requests(workspaceId) });
      }
    },
  });

  return (
    <ModalDialog
      title="Новая заявка на продление"
      description="Сервер зафиксирует текущие срок и стоимость. Продление всегда составляет 30 календарных дней."
      onClose={() => {
        if (!mutation.isPending) {
          onClose();
        }
      }}
    >
      <form
        className="form-stack"
        onSubmit={handleSubmit((values) => {
          setSubmitError(null);
          mutation.mutate(values.resourceId);
        })}
      >
        <div className="field">
          <label htmlFor="request-resource">Ресурс</label>
          <select
            id="request-resource"
            data-dialog-initial-focus
            autoFocus
            aria-invalid={errors.resourceId ? true : undefined}
            aria-describedby={errors.resourceId ? 'request-resource-error' : undefined}
            disabled={availableResources.length === 0 || mutation.isPending}
            {...register('resourceId', { required: 'Выберите ресурс без активной заявки.' })}
          >
            {availableResources.length === 0 && <option value="">Нет доступных ресурсов</option>}
            {availableResources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name} · {resource.externalId}
              </option>
            ))}
          </select>
          {errors.resourceId && (
            <span className="field-error" id="request-resource-error" role="alert">
              {errors.resourceId.message}
            </span>
          )}
        </div>

        {selectedResource && (
          <dl className="request-preview">
            <div>
              <dt>Текущий срок</dt>
              <dd>{formatDate(selectedResource.expiresOn)}</dd>
            </div>
            <div>
              <dt>Срок после продления</dt>
              <dd>{formatDate(addCalendarDays(selectedResource.expiresOn, 30) ?? selectedResource.expiresOn)}</dd>
            </div>
            <div>
              <dt>Стоимость</dt>
              <dd>{formatMoney(selectedResource.amountMinor, selectedResource.currency)}</dd>
            </div>
          </dl>
        )}

        {availableResources.length === 0 && (
          <p className="inline-notice">У всех ресурсов уже есть активные заявки.</p>
        )}
        {submitError !== null && (
          <div className="inline-error" role="alert">{getErrorMessage(submitError)}</div>
        )}
        <p className="form-hint">Срок ресурса изменится только после подтверждения провайдера.</p>
        <div className="dialog-actions">
          <button
            className="button button--secondary"
            type="button"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            className="button button--primary"
            type="submit"
            disabled={mutation.isPending || availableResources.length === 0}
          >
            {mutation.isPending ? 'Создаём…' : 'Создать заявку'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
