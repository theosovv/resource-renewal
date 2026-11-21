import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderClient } from './provider.client.js';
import type { ProviderRenewalPayload } from './provider.types.js';

const payload: ProviderRenewalPayload = {
  resourceId: 'res-a-01',
  periodMonths: 1,
  amountMinor: 128000n,
  currency: 'RUB',
};

const operation = {
  operation_id: 'provider-operation-1',
  status: 'completed',
  started_count: 1,
  resource_id: 'res-a-01',
  period_months: 1,
  amount_minor: 128000,
  currency: 'RUB',
};

describe('ProviderClient', () => {
  let client: ProviderClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new ProviderClient(
      new ConfigService({
        PROVIDER_BASE_URL: 'http://127.0.0.1:8091',
        PROVIDER_TIMEOUT_MS: 5000,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the immutable POST payload and validates a confirmed result', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(operation), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(client.post('operation-key', payload)).resolves.toEqual({
      kind: 'confirmed',
      operation: {
        operationId: 'provider-operation-1',
        status: 'completed',
        startedCount: 1,
        resourceId: 'res-a-01',
        periodMonths: 1,
        amountMinor: 128000,
        currency: 'RUB',
      },
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8091/renewals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'operation-key',
      },
      body: JSON.stringify({
        resource_id: 'res-a-01',
        period_months: 1,
        amount_minor: 128000,
        currency: 'RUB',
      }),
      signal: expect.any(AbortSignal),
    });
  });

  it('classifies the simulator first-response 503 as uncertain', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"response_lost"}', { status: 503 }));
    await expect(client.post('operation-key', payload)).resolves.toEqual({
      kind: 'uncertain',
      errorCode: 'PROVIDER_UNCERTAIN',
      httpStatus: 503,
    });
  });

  it('percent-encodes reconciliation keys and maps 404 without reading an error body', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"not_found"}', { status: 404 }));
    await expect(client.reconcile('key /?%ё', payload)).resolves.toEqual({
      kind: 'not_found',
      errorCode: 'PROVIDER_NOT_FOUND',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `http://127.0.0.1:8091/renewals/${encodeURIComponent('key /?%ё')}`,
    );
  });

  it.each([
    [{ ...operation, started_count: 2 }],
    [{ ...operation, amount_minor: 128001 }],
    [{ ...operation, resource_id: 'res-a-02' }],
    [{ ...operation, operation_id: '' }],
    [{ ...operation, status: 'processing' }],
    [{ ...operation, operation_key: 'another-operation-key' }],
  ])('rejects a completed response that does not match the request: %j', async (body) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(client.reconcile('operation-key', payload)).resolves.toEqual({
      kind: 'invalid_result',
      errorCode: 'PROVIDER_RESULT_MISMATCH',
    });
  });

  it('uses a dedicated safe code for idempotency payload conflicts', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"conflict"}', { status: 409 }));
    await expect(client.post('operation-key', payload)).resolves.toEqual({
      kind: 'non_retryable',
      errorCode: 'PROVIDER_PAYLOAD_CONFLICT',
      httpStatus: 409,
    });
  });

  it('treats network failures as uncertain and never exposes the thrown message', async () => {
    fetchMock.mockRejectedValue(new Error('sensitive response body must not escape'));
    await expect(client.post('operation-key', payload)).resolves.toEqual({
      kind: 'uncertain',
      errorCode: 'PROVIDER_UNCERTAIN',
    });
  });

  it('rejects unsafe JSON integers before any provider HTTP request', async () => {
    await expect(
      client.post('operation-key', { ...payload, amountMinor: 2n ** 60n }),
    ).resolves.toEqual({ kind: 'non_retryable', errorCode: 'PROVIDER_PAYLOAD_INVALID' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
