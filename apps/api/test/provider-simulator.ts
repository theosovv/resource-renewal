import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const providerBaseUrl = 'http://127.0.0.1:8091';
const providerPath = fileURLToPath(
  new URL('../../../tools/provider/provider_simulator.py', import.meta.url),
);

async function isHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${providerBaseUrl}/health`, {
      signal: AbortSignal.timeout(500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function startProviderSimulator(): Promise<ChildProcess> {
  if (await isHealthy()) {
    throw new Error(
      'M2 E2E requires a fresh provider simulator; stop the existing process on 127.0.0.1:8091',
    );
  }

  const child = spawn('python3', [providerPath], { stdio: 'ignore' });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Provider simulator exited with code ${child.exitCode}`);
    }
    if (await isHealthy()) {
      return child;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill('SIGTERM');
  throw new Error('Provider simulator did not become healthy');
}

export function stopProviderSimulator(child: ChildProcess | null): void {
  child?.kill('SIGTERM');
}

export async function providerOperationCount(resourceId: string): Promise<number> {
  const response = await fetch(
    `${providerBaseUrl}/stats?resource_id=${encodeURIComponent(resourceId)}`,
    { signal: AbortSignal.timeout(2_000) },
  );
  if (!response.ok) {
    throw new Error(`Provider stats returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as { operation_count?: unknown };
  if (typeof body.operation_count !== 'number') {
    throw new Error('Provider stats did not contain operation_count');
  }
  return body.operation_count;
}

export async function providerOperationStatus(operationKey: string): Promise<number> {
  const response = await fetch(
    `${providerBaseUrl}/renewals/${encodeURIComponent(operationKey)}`,
    { signal: AbortSignal.timeout(2_000) },
  );
  return response.status;
}
