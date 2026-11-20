import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { components } from '@resource-renewal/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';

type HealthResponse = components['schemas']['HealthResponse'];

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      this.logger.error('PostgreSQL health check failed');
      throw new ServiceUnavailableException('Database is unavailable');
    }
  }
}
