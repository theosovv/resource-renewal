import type { components } from '@resource-renewal/contracts';

export type ApiErrorBody = components['schemas']['ApiError'];
export type CurrentUser = components['schemas']['CurrentUser'];
export type Workspace = components['schemas']['Workspace'];
export type Resource = components['schemas']['Resource'];
export type RenewalRequest = components['schemas']['RenewalRequest'];
export type RenewalRequestDetail = components['schemas']['RenewalRequestDetail'];
export type RequestList = components['schemas']['RequestList'];
export type RequestStatus = components['schemas']['RequestStatus'];
export type JobStatus = components['schemas']['JobStatus'];
export type HistoryEvent = components['schemas']['HistoryEvent'];

type LoginInput = components['schemas']['LoginInput'];
type LoginResponse = components['schemas']['LoginResponse'];
type CsrfResponse = components['schemas']['CsrfResponse'];

const API_ROOT = '/api/v1';

let inMemoryCsrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal | undefined;
  csrf?: boolean;
  notifyUnauthorized?: boolean;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof value.status === 'number' &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.csrf) {
    if (!inMemoryCsrfToken) {
      throw new ApiError(403, 'CSRF_INVALID', 'CSRF token is not available');
    }
    headers['X-CSRF-Token'] = inMemoryCsrfToken;
  }

  const init: RequestInit = { method, headers, credentials: 'include' };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) {
    init.signal = options.signal;
  }

  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, init);
  } catch (error: unknown) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'The API is unavailable');
  }

  if (response.status === 204 && response.ok) {
    return undefined as T;
  }

  const body = await readJson(response);

  if (!response.ok) {
    const error = isApiErrorBody(body)
      ? new ApiError(response.status, body.code, body.message)
      : new ApiError(response.status, 'HTTP_ERROR', `Request failed with HTTP ${response.status}`);

    if (response.status === 401 && options.notifyUnauthorized !== false) {
      setCsrfToken(null);
      unauthorizedHandler?.();
    }

    if (response.status === 403 && error.code === 'CSRF_INVALID' && options.csrf) {
      let csrfRefreshed = false;
      try {
        const refreshed = await getCsrfToken(options.signal);
        setCsrfToken(refreshed.csrfToken);
        csrfRefreshed = true;
      } catch {
        // Keep the original CSRF error. A 401 from refresh has already ended the session.
      }
      if (csrfRefreshed) {
        throw new ApiError(403, 'CSRF_REFRESHED', 'CSRF token was refreshed');
      }
    }

    throw error;
  }

  if (body === null) {
    throw new ApiError(0, 'INVALID_RESPONSE', 'The API returned an invalid response');
  }

  return body as T;
}

export function setCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export async function login(input: LoginInput, signal?: AbortSignal): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: input,
    signal,
    notifyUnauthorized: false,
  });
}

export async function getCurrentUser(signal?: AbortSignal): Promise<CurrentUser> {
  return request<CurrentUser>('/auth/me', { signal });
}

export async function getCsrfToken(signal?: AbortSignal): Promise<CsrfResponse> {
  return request<CsrfResponse>('/auth/csrf', { signal });
}

export async function logout(signal?: AbortSignal): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST', csrf: true, signal });
}

export async function getWorkspaces(signal?: AbortSignal): Promise<{ items: Workspace[] }> {
  return request<{ items: Workspace[] }>('/workspaces', { signal });
}

export async function getResources(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<{ items: Resource[] }> {
  return request<{ items: Resource[] }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/resources`,
    { signal },
  );
}

export async function getRequests(
  workspaceId: string,
  signal?: AbortSignal,
  resourceId?: string,
): Promise<RequestList> {
  const query = resourceId ? `?resourceId=${encodeURIComponent(resourceId)}` : '';
  return request<RequestList>(`/workspaces/${encodeURIComponent(workspaceId)}/requests${query}`, {
    signal,
  });
}

export async function getRequestDetail(
  workspaceId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<RenewalRequestDetail> {
  return request<RenewalRequestDetail>(
    `/workspaces/${encodeURIComponent(workspaceId)}/requests/${encodeURIComponent(requestId)}`,
    { signal },
  );
}

export async function createRequest(workspaceId: string, resourceId: string): Promise<RenewalRequest> {
  return request<RenewalRequest>(`/workspaces/${encodeURIComponent(workspaceId)}/requests`, {
    method: 'POST',
    csrf: true,
    body: { resourceId },
  });
}

export type RequestAction = 'approve' | 'reject' | 'retry';

export async function performRequestAction(
  workspaceId: string,
  requestId: string,
  action: RequestAction,
): Promise<RenewalRequest> {
  return request<RenewalRequest>(
    `/workspaces/${encodeURIComponent(workspaceId)}/requests/${encodeURIComponent(requestId)}/${action}`,
    { method: 'POST', csrf: true },
  );
}
