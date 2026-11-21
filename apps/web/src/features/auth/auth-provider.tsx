import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ApiError,
  getCsrfToken,
  getCurrentUser,
  login,
  logout,
  setCsrfToken,
  setUnauthorizedHandler,
} from '../../api/client';
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, error: null });

  useEffect(() => {
    const controller = new AbortController();

    setUnauthorizedHandler(() => {
      setCsrfToken(null);
      queryClient.clear();
      setState({ status: 'anonymous', user: null, error: null });
    });

    async function bootstrap() {
      setState((current) => ({ ...current, status: 'loading', error: null }));
      try {
        const user = await getCurrentUser(controller.signal);
        const csrf = await getCsrfToken(controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        setCsrfToken(csrf.csrfToken);
        setState({ status: 'authenticated', user, error: null });
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        setCsrfToken(null);
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: 'anonymous', user: null, error: null });
        } else {
          setState({ status: 'error', user: null, error });
        }
      }
    }

    void bootstrap();
    return () => {
      controller.abort();
      setUnauthorizedHandler(null);
    };
  }, [bootstrapAttempt, queryClient]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const response = await login({ email, password });
      queryClient.clear();
      setCsrfToken(response.csrfToken);
      setState({ status: 'authenticated', user: response.user, error: null });
      return response.user;
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await logout();
    setCsrfToken(null);
    queryClient.clear();
    setState({ status: 'anonymous', user: null, error: null });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signIn,
      signOut,
      retryBootstrap: () => setBootstrapAttempt((attempt) => attempt + 1),
    }),
    [signIn, signOut, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
