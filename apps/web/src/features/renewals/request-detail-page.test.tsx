import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app';
import type { RenewalRequest } from '../../api/client';
import { csrfToken, detail, history, ids, renewal, user, workspace } from '../../test/fixtures';
import { jsonResponse, mockApi, problem, type ApiCall } from '../../test/mock-api';

const processingExecution = {
  status: 'PENDING',
  attemptsInCycle: 0,
  totalPostAttempts: 0,
  nextAttemptAt: '2026-11-21T10:02:00.000Z',
  lastErrorCode: null,
} as const;

describe('request detail and approver actions', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', `/w/${ids.workspace}/renewals/${ids.request}`);
  });

  it('confirms approval, refreshes execution state and preserves operation details', async () => {
    let currentRequest = renewal();
    let actionCall: ApiCall | undefined;
    mockApi(({ path, method, init }) => {
      if (path === '/api/v1/auth/me') return jsonResponse(user(ids.approver, ['APPROVER']));
      if (path === '/api/v1/auth/csrf') return jsonResponse({ csrfToken });
      if (path === '/api/v1/workspaces') return jsonResponse({ items: [workspace(['APPROVER'])] });
      if (path === `/api/v1/workspaces/${ids.workspace}/requests/${ids.request}/approve` && method === 'POST') {
        actionCall = { path, method, init };
        currentRequest = renewal({
          status: 'PROCESSING',
          decisionBy: ids.approver,
          decidedAt: '2026-11-21T10:01:00.000Z',
          execution: processingExecution,
        });
        return jsonResponse(currentRequest);
      }
      if (path === `/api/v1/workspaces/${ids.workspace}/requests/${ids.request}`) {
        const events = currentRequest.status === 'PROCESSING'
          ? history([{}, { actorUserId: ids.approver, actorDisplayName: 'Согласующий Alpha' }])
          : history();
        return jsonResponse(detail(currentRequest, events));
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const browserUser = userEvent.setup();
    render(<App />);

    const approveButton = await screen.findByRole('button', { name: 'Согласовать' });
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeInTheDocument();
    expect(screen.getByText('Фоновая задача ещё не создана. Она появится атомарно с согласованием заявки.')).toBeInTheDocument();
    await browserUser.click(approveButton);

    const dialog = screen.getByRole('dialog', { name: 'Согласовать заявку?' });
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toHaveFocus();
    await browserUser.click(within(dialog).getByRole('button', { name: 'Согласовать' }));

    expect(await screen.findByText('Ожидает обработки')).toBeInTheDocument();
    expect(screen.getByText('0 из 3')).toBeInTheDocument();
    expect(screen.getByText(currentRequest.operationKey)).toBeInTheDocument();
    expect(screen.getByText('На согласовании → Выполняется')).toBeInTheDocument();
    expect(actionCall?.init?.headers).toMatchObject({ 'X-CSRF-Token': csrfToken });
    expect(actionCall?.init?.body).toBeUndefined();
  });

  it('rejects through confirmation without sending a request body', async () => {
    let rejected = false;
    let actionCall: ApiCall | undefined;
    mockApi(({ path, method, init }) => {
      if (path === '/api/v1/auth/me') return jsonResponse(user(ids.approver, ['APPROVER']));
      if (path === '/api/v1/auth/csrf') return jsonResponse({ csrfToken });
      if (path === '/api/v1/workspaces') return jsonResponse({ items: [workspace(['APPROVER'])] });
      if (path === `/api/v1/workspaces/${ids.workspace}/requests/${ids.request}/reject` && method === 'POST') {
        actionCall = { path, method, init };
        rejected = true;
        return jsonResponse(renewal({ status: 'REJECTED', decisionBy: ids.approver }));
      }
      if (path === `/api/v1/workspaces/${ids.workspace}/requests/${ids.request}`) {
        const request = rejected
          ? renewal({ status: 'REJECTED', decisionBy: ids.approver })
          : renewal();
        return jsonResponse(detail(request));
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const browserUser = userEvent.setup();
    render(<App />);

    await browserUser.click(await screen.findByRole('button', { name: 'Отклонить' }));
    const dialog = screen.getByRole('dialog', { name: 'Отклонить заявку?' });
    await browserUser.click(within(dialog).getByRole('button', { name: 'Отклонить' }));
    expect(await screen.findByText('Отклонена')).toBeInTheDocument();
    expect(actionCall?.init?.body).toBeUndefined();
  });

  it('shows attention counters/error/history and retries with the same operation key', async () => {
    const operationKey = renewal().operationKey;
    let currentRequest: RenewalRequest = renewal({
      status: 'NEEDS_ATTENTION',
      execution: {
        status: 'WAITING_MANUAL',
        attemptsInCycle: 3,
        totalPostAttempts: 3,
        nextAttemptAt: '2026-11-21T10:05:00.000Z',
        lastErrorCode: 'PROVIDER_UNCERTAIN',
      },
    });
    let actionCall: ApiCall | undefined;
    mockApi(({ path, method, init }) => {
      if (path === '/api/v1/auth/me') return jsonResponse(user(ids.approver, ['APPROVER']));
      if (path === '/api/v1/auth/csrf') return jsonResponse({ csrfToken });
      if (path === '/api/v1/workspaces') return jsonResponse({ items: [workspace(['APPROVER'])] });
      if (path === `/api/v1/workspaces/${ids.workspace}/requests/${ids.request}/retry` && method === 'POST') {
        actionCall = { path, method, init };
        currentRequest = renewal({
          status: 'PROCESSING',
          execution: { ...processingExecution, totalPostAttempts: 3 },
        });
        return jsonResponse(currentRequest);
      }
      if (path === `/api/v1/workspaces/${ids.workspace}/requests/${ids.request}`) {
        return jsonResponse(detail(currentRequest));
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const browserUser = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('Автоматическая обработка остановлена')).toBeInTheDocument();
    expect(screen.getByText('3 из 3')).toBeInTheDocument();
    expect(screen.getAllByText('PROVIDER_UNCERTAIN').length).toBeGreaterThan(0);
    expect(screen.getByText('Ожидает ручного повтора')).toBeInTheDocument();
    await browserUser.click(screen.getByRole('button', { name: 'Повторить обработку' }));
    const dialog = screen.getByRole('dialog', { name: 'Повторить обработку?' });
    await browserUser.click(within(dialog).getByRole('button', { name: 'Повторить обработку' }));

    expect(await screen.findByText('Ожидает обработки')).toBeInTheDocument();
    expect(screen.getByText('0 из 3')).toBeInTheDocument();
    expect(screen.getByText(operationKey)).toBeInTheDocument();
    expect(actionCall?.path.endsWith('/retry')).toBe(true);
  });

  it('explains self-decision and does not offer forbidden action buttons', async () => {
    mockApi(({ path }) => {
      if (path === '/api/v1/auth/me') return jsonResponse(user(ids.initiator, ['INITIATOR', 'APPROVER']));
      if (path === '/api/v1/auth/csrf') return jsonResponse({ csrfToken });
      if (path === '/api/v1/workspaces') {
        return jsonResponse({ items: [workspace(['INITIATOR', 'APPROVER'])] });
      }
      if (path === `/api/v1/workspaces/${ids.workspace}/requests/${ids.request}`) {
        return jsonResponse(detail());
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    render(<App />);

    expect(await screen.findByText('Собственную заявку нельзя согласовать или отклонить. Нужен другой approver.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Согласовать' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отклонить' })).not.toBeInTheDocument();
  });

  it('keeps a visible 403 error inside the action dialog without logging out', async () => {
    mockApi(({ path, method }) => {
      if (path === '/api/v1/auth/me') return jsonResponse(user(ids.approver, ['APPROVER']));
      if (path === '/api/v1/auth/csrf') return jsonResponse({ csrfToken });
      if (path === '/api/v1/workspaces') return jsonResponse({ items: [workspace(['APPROVER'])] });
      if (path.endsWith('/approve') && method === 'POST') return problem(403, 'FORBIDDEN');
      if (path === `/api/v1/workspaces/${ids.workspace}/requests/${ids.request}`) {
        return jsonResponse(detail());
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const browserUser = userEvent.setup();
    render(<App />);

    await browserUser.click(await screen.findByRole('button', { name: 'Согласовать' }));
    const dialog = screen.getByRole('dialog', { name: 'Согласовать заявку?' });
    await browserUser.click(within(dialog).getByRole('button', { name: 'Согласовать' }));
    expect(await within(dialog).findByText('У вас нет доступа к этому пространству или действию.')).toBeInTheDocument();
    expect(screen.getByText('Согласующий Alpha')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows completed provider result and system history without further actions', async () => {
    const completedRequest = renewal({
      status: 'COMPLETED',
      providerOperationId: 'provider-operation-1',
      completedAt: '2026-11-21T10:06:00.000Z',
      execution: {
        status: 'SUCCEEDED',
        attemptsInCycle: 1,
        totalPostAttempts: 1,
        nextAttemptAt: '2026-11-21T10:06:00.000Z',
        lastErrorCode: null,
      },
    });
    const events = history([
      {},
      { actorUserId: ids.approver, actorDisplayName: 'Согласующий Alpha' },
      {
        actorType: 'SYSTEM',
        actorUserId: null,
        actorDisplayName: null,
        fromStatus: 'PROCESSING',
        toStatus: 'COMPLETED',
      },
    ]);
    mockApi(({ path }) => {
      if (path === '/api/v1/auth/me') return jsonResponse(user(ids.approver, ['APPROVER']));
      if (path === '/api/v1/auth/csrf') return jsonResponse({ csrfToken });
      if (path === '/api/v1/workspaces') return jsonResponse({ items: [workspace(['APPROVER'])] });
      if (path === `/api/v1/workspaces/${ids.workspace}/requests/${ids.request}`) {
        return jsonResponse(detail(completedRequest, events));
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    render(<App />);

    expect((await screen.findAllByText('Завершена')).length).toBeGreaterThan(0);
    expect(screen.getByText('provider-operation-1')).toBeInTheDocument();
    expect(screen.getByText('Задача завершена')).toBeInTheDocument();
    expect(screen.getByText('Выполняется → Завершена')).toBeInTheDocument();
    expect(screen.getByText('Система · worker')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Согласовать' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить обработку' })).not.toBeInTheDocument();
  });
});
