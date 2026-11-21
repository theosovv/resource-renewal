import type { RenewalJobAction } from '@prisma/client';
import type { ProviderRenewalPayload } from '../provider/provider.types.js';

export interface ClaimedRenewalJob {
  jobId: string;
  requestId: string;
  executionVersion: bigint;
  action: RenewalJobAction;
  attemptsInCycle: number;
  totalPostAttempts: number;
  operationKey: string;
  payload: ProviderRenewalPayload;
}

export interface ClaimGuard {
  jobId: string;
  requestId: string;
  executionVersion: bigint;
}

export type GuardedWriteResult = 'applied' | 'stale' | 'noop';
