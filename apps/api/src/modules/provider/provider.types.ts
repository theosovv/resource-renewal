export interface ProviderRenewalPayload {
  resourceId: string;
  periodMonths: number;
  amountMinor: bigint;
  currency: string;
}

export interface ProviderOperation {
  operationId: string;
  status: 'completed';
  startedCount: 1;
  resourceId: string;
  periodMonths: number;
  amountMinor: number;
  currency: string;
}

export type ProviderErrorCode =
  | 'PROVIDER_UNCERTAIN'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_PAYLOAD_CONFLICT'
  | 'PROVIDER_NON_RETRYABLE'
  | 'PROVIDER_RESULT_MISMATCH'
  | 'PROVIDER_PAYLOAD_INVALID';

export type ProviderCallOutcome =
  | { kind: 'confirmed'; operation: ProviderOperation }
  | { kind: 'not_found'; errorCode: 'PROVIDER_NOT_FOUND' }
  | {
      kind: 'uncertain';
      errorCode: 'PROVIDER_UNCERTAIN';
      httpStatus?: number;
    }
  | {
      kind: 'non_retryable';
      errorCode:
        | 'PROVIDER_PAYLOAD_CONFLICT'
        | 'PROVIDER_NON_RETRYABLE'
        | 'PROVIDER_PAYLOAD_INVALID';
      httpStatus?: number;
    }
  | { kind: 'invalid_result'; errorCode: 'PROVIDER_RESULT_MISMATCH' };
