import { createContext, useContext } from 'react';
import type { CurrentUser } from '../../api/client';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

export interface AuthState {
  status: AuthStatus;
  user: CurrentUser | null;
  error: unknown;
}

export interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<CurrentUser>;
  signOut: () => Promise<void>;
  retryBootstrap: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
