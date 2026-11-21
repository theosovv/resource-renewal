import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './app';
import type { RequestList, Resource } from './api/client';
import { csrfToken, detail, ids, renewal, resource, user, workspace } from './test/fixtures';
import { jsonResponse, mockApi, problem, type ApiCall } from './test/mock-api';

describe('M4 login and renewal flow', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/login');
  });

  it('logs in, creates a request with in-memory CSRF and opens its snapshot/history', async () => {
    const currentUser = user();
    let resources: Resource[] = [resource()];
    let requestList: RequestList = { items: [], total: 0 };
    let createdRequest = renewal();
    let loginCall: ApiCall | undefined;
    let createCall: ApiCall | undefined;

    mockApi(({ path, method, init }) => {
      if (path === '/api/v1/auth/me') return problem(401, 'UNAUTHORIZED');
      if (path === '/api/v1/auth/login' && method === 'POST') {
        loginCall = { path, method, init };
        return jsonResponse({ csrfToken, user: currentUser });
      }
      if (path === '/api/v1/auth/csrf') return jsonResponse({ csrfToken });
      if (path === '/api/v1/workspaces') return jsonResponse({ items: [workspace()] });
      if (path === `/api/v1/workspaces/${ids.workspace}/resources`) {
        return jsonResponse({ items: resources });
      }
      if (path === `/api/v1/workspaces/${ids.workspace}/requests` && method === 'GET') {
        return jsonResponse(requestList);
      }
      if (path === `/api/v1/workspaces/${ids.workspace}/requests` && method === 'POST') {
        createCall = { path, method, init };
        createdRequest = renewal();
        resources = [resource(ids.request)];
        requestList = { items: [createdRequest], total: 1 };
        return jsonResponse(createdRequest, 201);
      }
      if (path === `/api/v1/workspaces/${ids.workspace}/requests/${ids.request}`) {
        return jsonResponse(detail(createdRequest));
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });

    const browserUser = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Вход в Resource Renewal' })).toBeInTheDocument();
    await browserUser.type(screen.getByLabelText('Email'), 'initiator.alpha@example.test');
    await browserUser.type(screen.getByLabelText('Пароль'), 'AlphaInitiator!2027');
    await browserUser.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByRole('heading', { name: 'Заявки на продление' })).toBeInTheDocument();
    expect(screen.getByText('Рабочее пространство: Alpha')).toBeInTheDocument();
    expect(await screen.findByText('Заявок пока нет')).toBeInTheDocument();
    expect(screen.getByText(/1\s280,00 RUB/)).toBeInTheDocument();

    await browserUser.click(screen.getByRole('button', { name: 'Создать заявку' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая заявка на продление' });
    expect(within(dialog).getByLabelText('Ресурс')).toHaveValue(ids.resource);
    expect(within(dialog).getByText('31.03.2027')).toBeInTheDocument();
    await browserUser.click(within(dialog).getByRole('button', { name: 'Создать заявку' }));

    expect(await screen.findByRole('heading', { name: 'Заявка на продление' })).toBeInTheDocument();
    expect(screen.getByText('31.03.2027')).toBeInTheDocument();
    expect(screen.getByText(createdRequest.operationKey)).toBeInTheDocument();
    expect(screen.getByText('Создана · На согласовании')).toBeInTheDocument();
    expect(screen.getByText('Заявка ожидает решения согласующего.')).toBeInTheDocument();

    expect(loginCall?.init?.body).toBe(JSON.stringify({
      email: 'initiator.alpha@example.test',
      password: 'AlphaInitiator!2027',
    }));
    expect(createCall?.init?.body).toBe(JSON.stringify({ resourceId: ids.resource }));
    expect(createCall?.init?.credentials).toBe('include');
    expect(createCall?.init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('shows validation and invalid credentials without losing the login form', async () => {
    mockApi(({ path }) => {
      if (path === '/api/v1/auth/me') return problem(401, 'UNAUTHORIZED');
      if (path === '/api/v1/auth/login') return problem(401, 'UNAUTHORIZED');
      throw new Error(`Unexpected API call: ${path}`);
    });
    const browserUser = userEvent.setup();
    render(<App />);

    const loginButton = await screen.findByRole('button', { name: 'Войти' });
    await browserUser.click(loginButton);
    expect(await screen.findByText('Введите email.')).toBeInTheDocument();
    expect(screen.getByText('Введите пароль.')).toBeInTheDocument();

    await browserUser.type(screen.getByLabelText('Email'), 'wrong@example.test');
    await browserUser.type(screen.getByLabelText('Пароль'), 'wrong-password');
    await browserUser.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Неверный email или пароль.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('wrong@example.test');
  });

  it('restores a session, renders empty data and retries a failed resource request', async () => {
    window.history.replaceState({}, '', `/w/${ids.workspace}/renewals`);
    let resourcesFail = true;
    mockApi(({ path }) => {
      if (path === '/api/v1/auth/me') return jsonResponse(user());
      if (path === '/api/v1/auth/csrf') return jsonResponse({ csrfToken });
      if (path === '/api/v1/workspaces') return jsonResponse({ items: [workspace()] });
      if (path === `/api/v1/workspaces/${ids.workspace}/resources`) {
        return resourcesFail ? problem(500, 'INTERNAL_ERROR') : jsonResponse({ items: [resource()] });
      }
      if (path === `/api/v1/workspaces/${ids.workspace}/requests`) {
        return jsonResponse({ items: [], total: 0 });
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    const browserUser = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('Не удалось загрузить ресурсы')).toBeInTheDocument();
    expect(screen.getByText('Заявок пока нет')).toBeInTheDocument();
    resourcesFail = false;
    await browserUser.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Хранилище A')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить ресурсы')).not.toBeInTheDocument();
  });

  it('supports keyboard dismissal of the accessible create dialog', async () => {
    window.history.replaceState({}, '', `/w/${ids.workspace}/renewals`);
    mockApi(({ path }) => {
      if (path === '/api/v1/auth/me') return jsonResponse(user());
      if (path === '/api/v1/auth/csrf') return jsonResponse({ csrfToken });
      if (path === '/api/v1/workspaces') return jsonResponse({ items: [workspace()] });
      if (path === `/api/v1/workspaces/${ids.workspace}/resources`) return jsonResponse({ items: [resource()] });
      if (path === `/api/v1/workspaces/${ids.workspace}/requests`) return jsonResponse({ items: [], total: 0 });
      throw new Error(`Unexpected API call: ${path}`);
    });
    const browserUser = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('Хранилище A')).toBeInTheDocument();
    const createButton = screen.getByRole('button', { name: 'Создать заявку' });
    expect(createButton).toBeEnabled();
    createButton.focus();
    await browserUser.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Новая заявка на продление' })).toBeInTheDocument();
    await browserUser.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(createButton).toHaveFocus();
  });
});
