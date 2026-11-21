import type {
  CurrentUser,
  HistoryEvent,
  RenewalRequest,
  RenewalRequestDetail,
  Resource,
  Workspace,
} from '../api/client';

export const ids = {
  workspace: '10000000-0000-4000-8000-000000000001',
  resource: '30000000-0000-4000-8000-000000000001',
  request: '40000000-0000-4000-8000-000000000001',
  initiator: '20000000-0000-4000-8000-000000000001',
  approver: '20000000-0000-4000-8000-000000000002',
};

export const csrfToken = 'a'.repeat(64);

export function workspace(roles: Workspace['roles'] = ['INITIATOR']): Workspace {
  return { id: ids.workspace, code: 'ALPHA', name: 'Alpha', roles };
}

export function user(
  id = ids.initiator,
  roles: Workspace['roles'] = ['INITIATOR'],
): CurrentUser {
  const selectedWorkspace = workspace(roles);
  return {
    id,
    email: id === ids.approver ? 'approver.alpha@example.test' : 'initiator.alpha@example.test',
    displayName: id === ids.approver ? 'Согласующий Alpha' : 'Инициатор Alpha',
    memberships: [{
      workspaceId: selectedWorkspace.id,
      workspaceCode: selectedWorkspace.code,
      workspaceName: selectedWorkspace.name,
      roles,
    }],
  };
}

export function resource(activeRequestId: string | null = null): Resource {
  return {
    id: ids.resource,
    workspaceId: ids.workspace,
    externalId: 'res-a-01',
    name: 'Хранилище A',
    expiresOn: '2027-03-01',
    amountMinor: 128000,
    currency: 'RUB',
    activeRequestId,
  };
}

export function renewal(overrides: Partial<RenewalRequest> = {}): RenewalRequest {
  return {
    id: ids.request,
    workspaceId: ids.workspace,
    resourceId: ids.resource,
    createdBy: ids.initiator,
    decisionBy: null,
    status: 'PENDING_APPROVAL',
    snapshot: {
      oldExpiry: '2027-03-01',
      newExpiry: '2027-03-31',
      amountMinor: 128000,
      currency: 'RUB',
      periodMonths: 1,
    },
    operationKey: '50000000-0000-4000-8000-000000000001',
    providerOperationId: null,
    execution: null,
    createdAt: '2026-11-21T10:00:00.000Z',
    updatedAt: '2026-11-21T10:00:00.000Z',
    decidedAt: null,
    completedAt: null,
    ...overrides,
  };
}

export function history(events: Partial<HistoryEvent>[] = [{}]): HistoryEvent[] {
  return events.map((event, index) => ({
    id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    actorType: 'USER',
    actorUserId: ids.initiator,
    actorDisplayName: 'Инициатор Alpha',
    fromStatus: index === 0 ? null : 'PENDING_APPROVAL',
    toStatus: index === 0 ? 'PENDING_APPROVAL' : 'PROCESSING',
    reasonCode: null,
    createdAt: `2026-11-21T10:0${index}:00.000Z`,
    ...event,
  }));
}

export function detail(
  request: RenewalRequest = renewal(),
  events: HistoryEvent[] = history(),
): RenewalRequestDetail {
  return {
    ...request,
    resource: resource(
      ['PENDING_APPROVAL', 'PROCESSING', 'NEEDS_ATTENTION'].includes(request.status)
        ? ids.request
        : null,
    ),
    history: events,
  };
}
