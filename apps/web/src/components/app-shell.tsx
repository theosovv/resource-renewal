import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Workspace } from '../api/client';
import { getErrorMessage } from '../api/error-messages';
import { useAuth } from '../features/auth/auth-context';

export function AppShell({
  children,
  workspaces = [],
  currentWorkspace,
}: {
  children: ReactNode;
  workspaces?: Workspace[];
  currentWorkspace?: Workspace | undefined;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<unknown>(null);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Перейти к содержимому</a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link className="brand" to="/" aria-label="Resource Renewal — главная">
            <span className="brand-mark" aria-hidden="true">R</span>
            Resource Renewal
          </Link>
          <div className="header-controls">
            {workspaces.length > 0 && (
              <div className="workspace-control">
                <label htmlFor="workspace-select">Пространство</label>
                <select
                  id="workspace-select"
                  value={currentWorkspace?.id ?? ''}
                  onChange={(event) => {
                    const workspaceId = event.target.value;
                    if (workspaceId) {
                      void navigate(`/w/${workspaceId}/renewals`);
                    }
                  }}
                >
                  {!currentWorkspace && <option value="">Выберите пространство</option>}
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="user-control">
              <span className="user-name">{user?.displayName}</span>
              <span className="user-email">{user?.email}</span>
            </div>
            <button
              className="button button--secondary"
              type="button"
              disabled={isLoggingOut}
              onClick={async () => {
                setIsLoggingOut(true);
                setLogoutError(null);
                try {
                  await signOut();
                  void navigate('/login', { replace: true });
                } catch (error: unknown) {
                  setLogoutError(error);
                } finally {
                  setIsLoggingOut(false);
                }
              }}
            >
              {isLoggingOut ? 'Выход…' : 'Выйти'}
            </button>
          </div>
        </div>
        {logoutError !== null && (
          <div className="site-header__inner">
            <p className="inline-error" role="alert">{getErrorMessage(logoutError)}</p>
          </div>
        )}
      </header>
      <main className="main-content" id="main-content">{children}</main>
      <footer className="site-footer">Локальная среда · PostgreSQL-backed worker</footer>
    </div>
  );
}
