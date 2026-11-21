import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { HomeRedirect, NoWorkspacePage, NotFoundPage, ProtectedRoute } from './features/auth/auth-pages';
import { AuthProvider } from './features/auth/auth-provider';
import { LoginPage } from './features/auth/login-page';
import { RenewalsPage } from './features/renewals/renewals-page';
import { RequestDetailPage } from './features/renewals/request-detail-page';
import { WorkspaceIndexRedirect, WorkspaceLayout } from './features/workspaces/workspace-layout';

export function App() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 1000,
      },
      mutations: {
        retry: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/no-workspace" element={<NoWorkspacePage />} />
              <Route path="/w/:workspaceId" element={<WorkspaceLayout />}>
                <Route index element={<WorkspaceIndexRedirect />} />
                <Route path="renewals" element={<RenewalsPage />} />
                <Route path="renewals/:requestId" element={<RequestDetailPage />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
