import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { getErrorMessage } from '../../api/error-messages';
import { ErrorState, LoadingState } from '../../components/feedback';
import { useAuth } from './auth-context';
import { defaultWorkspacePath } from './auth-navigation';

interface LoginForm {
  email: string;
  password: string;
}

interface ReturnLocation {
  from?: string;
}

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ defaultValues: { email: '', password: '' } });

  if (auth.status === 'loading') {
    return (
      <main className="centered-page">
        <LoadingState label="Проверяем сессию…" />
      </main>
    );
  }

  if (auth.status === 'error') {
    return (
      <main className="centered-page">
        <ErrorState
          title="Не удалось проверить сессию"
          error={auth.error}
          onRetry={auth.retryBootstrap}
        />
      </main>
    );
  }

  if (auth.user) {
    const requestedPath = (location.state as ReturnLocation | null)?.from;
    const canReturn = requestedPath
      ? auth.user.memberships.some((membership) =>
          requestedPath.startsWith(`/w/${membership.workspaceId}/`),
        )
      : false;
    return <Navigate to={requestedPath && canReturn ? requestedPath : defaultWorkspacePath(auth.user)} replace />;
  }

  return (
    <div className="login-page">
      <header className="login-brand">
        <a className="brand" href="/" aria-label="Resource Renewal — главная">
          <span className="brand-mark" aria-hidden="true">R</span>
          Resource Renewal
        </a>
      </header>
      <main className="login-main">
        <section className="login-card" aria-labelledby="login-title">
          <p className="eyebrow">Локальный доступ</p>
          <h1 id="login-title">Вход в Resource Renewal</h1>
          <p className="login-description">
            Войдите с одной из учётных записей из README. Регистрация не требуется.
          </p>
          <form
            className="form-stack"
            noValidate
            onSubmit={handleSubmit(async (values) => {
              setSubmitError(null);
              try {
                await auth.signIn(values.email.trim(), values.password);
              } catch (error: unknown) {
                if (error instanceof ApiError && error.status === 401) {
                  setSubmitError(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials'));
                } else {
                  setSubmitError(error);
                }
              }
            })}
          >
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...register('email', {
                  required: 'Введите email.',
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: 'Введите корректный email.',
                  },
                })}
              />
              {errors.email && (
                <span className="field-error" id="email-error" role="alert">
                  {errors.email.message}
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="password">Пароль</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={errors.password ? 'password-error' : undefined}
                {...register('password', { required: 'Введите пароль.' })}
              />
              {errors.password && (
                <span className="field-error" id="password-error" role="alert">
                  {errors.password.message}
                </span>
              )}
            </div>
            {submitError !== null && (
              <div className="inline-error" role="alert">
                {submitError instanceof ApiError && submitError.code === 'INVALID_CREDENTIALS'
                  ? 'Неверный email или пароль.'
                  : getErrorMessage(submitError)}
              </div>
            )}
            <button className="button button--primary button--wide" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Выполняем вход…' : 'Войти'}
            </button>
          </form>
          <p className="security-note">
            Сессия хранится в HttpOnly cookie. Пароль и защитные токены не сохраняются в Web Storage.
          </p>
        </section>
      </main>
    </div>
  );
}
