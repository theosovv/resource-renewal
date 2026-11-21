import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FaultProviderResponse {
  status: number;
  body?: unknown;
}

export interface ProviderPostCall {
  key: string;
  payload: unknown;
}

export interface FaultProvider {
  baseUrl: string;
  postCalls: ProviderPostCall[];
  getCalls: string[];
  setPostHandler: (
    handler: (call: ProviderPostCall) => Promise<FaultProviderResponse> | FaultProviderResponse,
  ) => void;
  setGetHandler: (
    handler: (key: string) => Promise<FaultProviderResponse> | FaultProviderResponse,
  ) => void;
  close: () => Promise<void>;
}

export function completedProviderResponse(
  call: ProviderPostCall | { payload: unknown },
  operationId = 'fault-provider-operation-1',
): FaultProviderResponse {
  const payload = call.payload as Record<string, unknown>;
  return {
    status: 200,
    body: {
      operation_id: operationId,
      status: 'completed',
      started_count: 1,
      ...payload,
    },
  };
}

export async function startFaultProvider(): Promise<FaultProvider> {
  const postCalls: ProviderPostCall[] = [];
  const getCalls: string[] = [];
  let postHandler: (
    call: ProviderPostCall,
  ) => Promise<FaultProviderResponse> | FaultProviderResponse = () => ({
    status: 503,
    body: { error: 'response_lost' },
  });
  let getHandler: (key: string) => Promise<FaultProviderResponse> | FaultProviderResponse = () => ({
    status: 404,
    body: { error: 'not_found' },
  });

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'POST' && url.pathname === '/renewals') {
        const key = request.headers['idempotency-key'];
        if (typeof key !== 'string' || !key) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'invalid_idempotency_key' }));
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const call = { key, payload };
        postCalls.push(call);
        const result = await postHandler(call);
        response.writeHead(result.status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(result.body ?? { error: 'fault_provider_error' }));
        return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/renewals/')) {
        const key = decodeURIComponent(url.pathname.slice('/renewals/'.length));
        getCalls.push(key);
        const result = await getHandler(key);
        response.writeHead(result.status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(result.body ?? { error: 'fault_provider_error' }));
        return;
      }
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
    } catch {
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
      }
      response.end(JSON.stringify({ error: 'fault_provider_failure' }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    postCalls,
    getCalls,
    setPostHandler: (handler) => {
      postHandler = handler;
    },
    setGetHandler: (handler) => {
      getHandler = handler;
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
