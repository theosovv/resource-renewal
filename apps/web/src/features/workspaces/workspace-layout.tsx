import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { getWorkspaces } from '../../api/client';
import { queryKeys } from '../../api/query-keys';
import { AppShell } from '../../components/app-shell';
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback';
import { useWorkspace } from './workspace-context';

export function WorkspaceLayout() {
  const { workspaceId = '' } = useParams();
  const workspacesQuery = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: ({ signal }) => getWorkspaces(signal),
  });
  const workspaces = workspacesQuery.data?.items ?? [];
  const currentWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);

  let content;
  if (workspacesQuery.isPending) {
    content = <LoadingState label="Загружаем доступные пространства…" />;
  } else if (workspacesQuery.isError) {
    content = (
      <ErrorState
        error={workspacesQuery.error}
        title="Не удалось загрузить пространства"
        onRetry={() => void workspacesQuery.refetch()}
      />
    );
  } else if (!currentWorkspace) {
    content = (
      <EmptyState
        title="Нет доступа к пространству"
        description="Пространство не существует или ваше membership было отозвано. Выберите доступное пространство в шапке."
      />
    );
  } else {
    content = <Outlet context={currentWorkspace} />;
  }

  return (
    <AppShell workspaces={workspaces} currentWorkspace={currentWorkspace}>
      {content}
    </AppShell>
  );
}

export function WorkspaceIndexRedirect() {
  const workspace = useWorkspace();
  return <Navigate to={`/w/${workspace.id}/renewals`} replace />;
}
