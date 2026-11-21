import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './app';
import { csrfToken, detail, ids, renewal, resource, user, workspace } from './test/fixtures';
import { emptyResponse, jsonResponse, mockApi, problem, type ApiCall } from './test/mock-api';

describe('session expiry, logout and API conflicts', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', `/w/${ids.workspace}/renewals`);
  });

  it('redirects to login and clears protected data after a 401', async () => {
    mockApi(({ path }) => {
      if (path === '/api/v1/auth/me') return jsonResponse(user());
      if (path === '/api/v1/auth/csrf') return jsonResponse({ csrfToken });
      if (path === '/api/v1/workspaces') return jsonResponse({ items: [workspace()] });
      if (path.includes('/resources') || path.includes('/requests')) return problem(401, 'UNAUTHORIZED');
      throw new Error(`Unexpected API call: ${path}`);
    });
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Вход в Resource Renewal' })).toBeInTheDocument();
    expect(screen.queryByText('Хранилище A')).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });

  it('logs out with the session-bound CSRF header', async () => {
    let logoutCall: ApiCall | undefined;
    mockApi(({ path, method, init }) => {
      if (path === '/api/v1/auth/me') return jsonResponse(user());
      if (path === '/api/v1/auth/csrf') return jsonResponse({ csrfToken });
      if (path === '/api/v1/workspaces') return jsonResponse({ items: [workspace()] });
      if (path === `/api/v1/workspaces/${ids.workspace}/resources`) return jsonResponse({ items: [] });
      if (path === `/api/v1/workspaces/${ids.workspace}/requests`) return jsonResponse({ items: [], total: 0 });
      if (path === '/api/v1/auth/logout' && method === 'POST') {
        logoutCall = { path, method, init };
        return emptyResponse();
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const browserUser = userEvent.setup();
    render(<App />);

    await browserUser.click(await screen.findByRole('button', { name: 'Выйти' }));
    expect(await screen.findByRole('heading', { name: 'Вход в Resource Renewal' })).toBeInTheDocument();
    expect(logoutCall?.init?.headers).toMatchObject({ 'X-CSRF-Token': csrfToken });
  });

  it('shows a create conflict, refetches current data and keeps the session', async () => {
    let hasConflict = false;
    mockApi(({ path, method }) => {
      if (path === '/api/v1/auth/me') return jsonResponse(user());
      if (path === '/api/v1/auth/csrf') return jsonResponse({ csrfToken });
      if (path === '/api/v1/workspaces') return jsonResponse({ items: [workspace()] });
      if (path === `/api/v1/workspaces/${ids.workspace}/resources`) {
        return jsonResponse({ items: [resource(hasConflict ? ids.request : null)] });
      }
      if (path === `/api/v1/workspaces/${ids.workspace}/requests` && method === 'GET') {
        return jsonResponse(hasConflict ? { items: [renewal()], total: 1 } : { items: [], total: 0 });
      }
      if (path === `/api/v1/workspaces/${ids.workspace}/requests` && method === 'POST') {
        hasConflict = true;
        return problem(409, 'REQUEST_ALREADY_ACTIVE');
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const browserUser = userEvent.setup();
    render(<App />);

    await browserUser.click(await screen.findByRole('button', { name: 'Создать заявку' }));
    const dialog = screen.getByRole('dialog', { name: 'Новая заявка на продление' });
    await browserUser.click(within(dialog).getByRole('button', { name: 'Создать заявку' }));
    expect(await within(dialog).findByText('У ресурса уже есть активная заявка. Откройте её в списке ресурсов.')).toBeInTheDocument();
    expect((await screen.findAllByText('На согласовании')).length).toBeGreaterThan(0);
    expect(screen.getByText('Инициатор Alpha')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('refreshes a rejected CSRF token and lets the user repeat the mutation', async () => {
    const refreshedToken = 'b'.repeat(64);
    const csrfCalls: string[] = [];
    let mutationCount = 0;
    let csrfRequestCount = 0;
    let created = false;
    mockApi(({ path, method, init }) => {
      if (path === '/api/v1/auth/me') return jsonResponse(user());
      if (path === '/api/v1/auth/csrf') {
        csrfRequestCount += 1;
        return jsonResponse({ csrfToken: csrfRequestCount === 1 ? csrfToken : refreshedToken });
      }
      if (path === '/api/v1/workspaces') return jsonResponse({ items: [workspace()] });
      if (path === `/api/v1/workspaces/${ids.workspace}/resources`) {
        return jsonResponse({ items: [resource(created ? ids.request : null)] });
      }
      if (path === `/api/v1/workspaces/${ids.workspace}/requests` && method === 'GET') {
        return jsonResponse(created ? { items: [renewal()], total: 1 } : { items: [], total: 0 });
      }
      if (path === `/api/v1/workspaces/${ids.workspace}/requests` && method === 'POST') {
        mutationCount += 1;
        const headers = init?.headers as Record<string, string>;
        csrfCalls.push(headers['X-CSRF-Token'] ?? '');
        if (mutationCount === 1) return problem(403, 'CSRF_INVALID');
        created = true;
        return jsonResponse(renewal(), 201);
      }
      if (path === `/api/v1/workspaces/${ids.workspace}/requests/${ids.request}`) {
        return jsonResponse(detail());
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const browserUser = userEvent.setup();
    render(<App />);

    await browserUser.click(await screen.findByRole('button', { name: 'Создать заявку' }));
    const dialog = screen.getByRole('dialog', { name: 'Новая заявка на продление' });
    await browserUser.click(within(dialog).getByRole('button', { name: 'Создать заявку' }));
    expect(await within(dialog).findByText('Защитный токен обновлён. Повторите действие ещё раз.')).toBeInTheDocument();
    await browserUser.click(within(dialog).getByRole('button', { name: 'Создать заявку' }));
    expect(await screen.findByRole('heading', { name: 'Заявка на продление' })).toBeInTheDocument();
    expect(csrfCalls).toEqual([csrfToken, refreshedToken]);
  });
});
