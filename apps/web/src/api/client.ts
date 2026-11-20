import type { components } from '@resource-renewal/contracts';

type HealthResponse = components['schemas']['HealthResponse'];

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'ok'
  );
}

export async function getHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/v1/health', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Health request failed with HTTP ${response.status}`);
  }

  const body: unknown = await response.json();
  if (!isHealthResponse(body)) {
    throw new Error('Health response does not match the API contract');
  }

  return body;
}
