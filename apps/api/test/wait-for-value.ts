interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  description?: string;
}

export async function waitForValue<T>(
  read: () => Promise<T | null | undefined | false>,
  options: WaitOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${options.description ?? 'persisted state'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
