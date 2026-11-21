import { Module } from '@nestjs/common';
import { ProviderModule } from '../provider/provider.module.js';
import { RenewalsModule } from '../renewals/renewals.module.js';
import { JobsService } from './jobs.service.js';
import { JobsWorker } from './jobs.worker.js';

@Module({
  imports: [ProviderModule, RenewalsModule],
  providers: [JobsService, JobsWorker],
  exports: [JobsService],
})
export class JobsModule {}
