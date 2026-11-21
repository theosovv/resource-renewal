import { getErrorMessage } from '../api/error-messages';

export function LoadingState({ label = 'Загружаем данные…' }: { label?: string }) {
  return (
    <div className="feedback feedback--loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="feedback">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = 'Не удалось загрузить данные',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div className="feedback feedback--error" role="alert">
      <strong>{title}</strong>
      <p>{getErrorMessage(error)}</p>
      {onRetry && (
        <button className="button button--secondary" type="button" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}
