import { vi } from 'vitest';

export interface ApiCall {
  path: string;
  method: string;
  init?: RequestInit | undefined;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

export function emptyResponse(status = 204): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

export function problem(status: number, code: string, message = code): Response {
  return jsonResponse({ status, code, message }, status);
}

export function mockApi(
  handler: (call: ApiCall) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, 'http://web.test');
    return handler({ path: `${url.pathname}${url.search}`, method: init?.method ?? 'GET', init });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
