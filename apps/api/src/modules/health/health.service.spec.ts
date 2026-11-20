import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('checks PostgreSQL before reporting ok', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]) };
    const service = new HealthService(prisma as unknown as PrismaService);

    await expect(service.check()).resolves.toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it('does not expose database errors', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error('private database details')) };
    const service = new HealthService(prisma as unknown as PrismaService);

    await expect(service.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
