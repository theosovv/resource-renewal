import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import type { HealthService } from './health.service.js';

describe('HealthController', () => {
  it('returns the health service result', async () => {
    const healthService = {
      check: vi.fn().mockResolvedValue({ status: 'ok' }),
    };
    const controller = new HealthController(healthService as unknown as HealthService);

    await expect(controller.check()).resolves.toEqual({ status: 'ok' });
    expect(healthService.check).toHaveBeenCalledOnce();
  });
});
