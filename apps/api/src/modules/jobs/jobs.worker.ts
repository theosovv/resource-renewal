import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { RenewalJobAction } from '@prisma/client';
import { ProviderClient } from '../provider/provider.client.js';
import type { ProviderCallOutcome } from '../provider/provider.types.js';
import { RenewalExecutionService } from '../renewals/renewal-execution.service.js';
import { JobsService } from './jobs.service.js';
import type { ClaimedRenewalJob } from './jobs.types.js';

@Injectable()
export class JobsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsWorker.name);
  private readonly workerId = randomUUID();
  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private readonly retryDelayMs: number;
  private readonly leaseMs: number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopping = false;

  constructor(
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(ProviderClient) private readonly provider: ProviderClient,
    @Inject(RenewalExecutionService) private readonly execution: RenewalExecutionService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.enabled = config.getOrThrow<boolean>('WORKER_ENABLED');
    this.pollIntervalMs = config.getOrThrow<number>('WORKER_POLL_INTERVAL_MS');
    this.retryDelayMs = config.getOrThrow<number>('RENEWAL_RETRY_DELAY_MS');
    this.leaseMs = config.getOrThrow<number>('RENEWAL_JOB_LEASE_MS');
  }

  onModuleInit(): void {
    if (this.enabled) {
      this.schedule(0);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.inFlight;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      const current = this.runPollingCycle();
      this.inFlight = current;
      void current.finally(() => {
        if (this.inFlight === current) {
          this.inFlight = null;
        }
        if (!this.stopping) {
          this.schedule(this.pollIntervalMs);
        }
      });
    }, delayMs);
  }

  private async runPollingCycle(): Promise<void> {
    if (this.stopping) {
      return;
    }
    try {
      const claim = await this.jobs.claim(this.workerId, this.leaseMs);
      if (claim) {
        await this.process(claim);
      }
    } catch (error) {
      if (this.stopping) {
        return;
      }
      this.stopping = true;
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(`Fatal worker polling failure (${errorName}); terminating the process`);
      process.exit(1);
    }
  }

  private async process(claim: ClaimedRenewalJob): Promise<void> {
    const outcome =
      claim.action === RenewalJobAction.POST
        ? await this.provider.post(claim.operationKey, claim.payload)
        : await this.provider.reconcile(claim.operationKey, claim.payload);

    if (outcome.kind === 'confirmed') {
      await this.execution.finalize(claim, outcome.operation);
      return;
    }
    if (outcome.kind === 'non_retryable' || outcome.kind === 'invalid_result') {
      await this.execution.attention(claim, outcome.errorCode);
      return;
    }
    if (claim.action === RenewalJobAction.POST) {
      await this.rescheduleAfterPost(claim, outcome);
      return;
    }
    await this.rescheduleAfterReconcile(claim, outcome);
  }

  private async rescheduleAfterPost(
    claim: ClaimedRenewalJob,
    outcome: Extract<ProviderCallOutcome, { kind: 'uncertain' | 'not_found' }>,
  ): Promise<void> {
    await this.jobs.reschedule(
      claim,
      RenewalJobAction.RECONCILE,
      this.retryDelayMs,
      outcome.errorCode,
    );
  }

  private async rescheduleAfterReconcile(
    claim: ClaimedRenewalJob,
    outcome: Extract<ProviderCallOutcome, { kind: 'uncertain' | 'not_found' }>,
  ): Promise<void> {
    if (claim.attemptsInCycle >= 3) {
      await this.execution.attention(claim, outcome.errorCode);
      return;
    }
    await this.jobs.reschedule(
      claim,
      RenewalJobAction.POST,
      outcome.kind === 'not_found' ? 0 : this.retryDelayMs,
      outcome.errorCode,
    );
  }
}
