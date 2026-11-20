import { Controller, Get, Inject } from '@nestjs/common';
import type { components } from '@resource-renewal/contracts';
import { Public } from '../auth/public.decorator.js';
import { HealthService } from './health.service.js';

type HealthResponse = components['schemas']['HealthResponse'];

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Public()
  @Get()
  check(): Promise<HealthResponse> {
    return this.healthService.check();
  }
}
