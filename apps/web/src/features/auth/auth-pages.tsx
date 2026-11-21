import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppShell } from '../../components/app-shell';
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback';
import { useAuth } from './auth-context';
import { defaultWorkspacePath } from './auth-navigation';

export function HomeRedirect() {
  const auth = useAuth();
  if (auth.status === 'loading') {
    return <main className="centered-page"><LoadingState label="Проверяем сессию…" /></main>;
  }
  if (auth.status === 'error') {
    return (
      <main className="centered-page">
        <ErrorState error={auth.error} onRetry={auth.retryBootstrap} />
      </main>
    );
  }
  return <Navigate to={auth.user ? defaultWorkspacePath(auth.user) : '/login'} replace />;
}

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') {
    return <main className="centered-page"><LoadingState label="Проверяем сессию…" /></main>;
  }
  if (auth.status === 'error') {
    return (
      <main className="centered-page">
        <ErrorState
          title="Не удалось восстановить сессию"
          error={auth.error}
          onRetry={auth.retryBootstrap}
        />
      </main>
    );
  }
  if (!auth.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export function NoWorkspacePage() {
  return (
    <AppShell>
      <EmptyState
        title="Нет доступных пространств"
        description="Обратитесь к администратору локального окружения, чтобы получить membership. Можно выйти и войти другой учётной записью."
      />
    </AppShell>
  );
}

export function NotFoundPage() {
  return (
    <main className="centered-page">
      <p className="eyebrow">404</p>
      <h1>Страница не найдена</h1>
      <p className="muted">Проверьте адрес или вернитесь к списку заявок.</p>
      <Link className="button button--primary" to="/">На главную</Link>
    </main>
  );
}
