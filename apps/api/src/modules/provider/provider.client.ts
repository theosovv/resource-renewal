import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { minorUnitsToJsonNumber } from '../../common/serialization/minor-units.js';
import type {
  ProviderCallOutcome,
  ProviderOperation,
  ProviderRenewalPayload,
} from './provider.types.js';

@Injectable()
export class ProviderClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('PROVIDER_BASE_URL');
    this.timeoutMs = config.getOrThrow<number>('PROVIDER_TIMEOUT_MS');
  }

  async post(
    operationKey: string,
    payload: ProviderRenewalPayload,
  ): Promise<ProviderCallOutcome> {
    const wirePayload = this.toWirePayload(operationKey, payload);
    if (!wirePayload) {
      return { kind: 'non_retryable', errorCode: 'PROVIDER_PAYLOAD_INVALID' };
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/renewals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': operationKey,
        },
        body: JSON.stringify(wirePayload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { kind: 'uncertain', errorCode: 'PROVIDER_UNCERTAIN' };
    }

    if (response.status === 200) {
      return this.confirmedOrInvalid(response, operationKey, payload);
    }
    if (response.status === 409) {
      return {
        kind: 'non_retryable',
        errorCode: 'PROVIDER_PAYLOAD_CONFLICT',
        httpStatus: response.status,
      };
    }
    if (response.status >= 500 && response.status <= 599) {
      return {
        kind: 'uncertain',
        errorCode: 'PROVIDER_UNCERTAIN',
        httpStatus: response.status,
      };
    }
    return {
      kind: 'non_retryable',
      errorCode: 'PROVIDER_NON_RETRYABLE',
      httpStatus: response.status,
    };
  }

  async reconcile(
    operationKey: string,
    payload: ProviderRenewalPayload,
  ): Promise<ProviderCallOutcome> {
    if (!this.toWirePayload(operationKey, payload)) {
      return { kind: 'non_retryable', errorCode: 'PROVIDER_PAYLOAD_INVALID' };
    }

    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/renewals/${encodeURIComponent(operationKey)}`,
        { signal: AbortSignal.timeout(this.timeoutMs) },
      );
    } catch {
      return { kind: 'uncertain', errorCode: 'PROVIDER_UNCERTAIN' };
    }

    if (response.status === 200) {
      return this.confirmedOrInvalid(response, operationKey, payload);
    }
    if (response.status === 404) {
      return { kind: 'not_found', errorCode: 'PROVIDER_NOT_FOUND' };
    }
    if (response.status >= 500 && response.status <= 599) {
      return {
        kind: 'uncertain',
        errorCode: 'PROVIDER_UNCERTAIN',
        httpStatus: response.status,
      };
    }
    return {
      kind: 'non_retryable',
      errorCode: 'PROVIDER_NON_RETRYABLE',
      httpStatus: response.status,
    };
  }

  private toWirePayload(
    operationKey: string,
    payload: ProviderRenewalPayload,
  ): {
    resource_id: string;
    period_months: number;
    amount_minor: number;
    currency: string;
  } | null {
    if (
      !operationKey.trim() ||
      operationKey.length > 255 ||
      !payload.resourceId.trim() ||
      payload.resourceId.length > 255 ||
      payload.periodMonths !== 1 ||
      payload.currency !== 'RUB'
    ) {
      return null;
    }
    try {
      return {
        resource_id: payload.resourceId,
        period_months: payload.periodMonths,
        amount_minor: minorUnitsToJsonNumber(payload.amountMinor),
        currency: payload.currency,
      };
    } catch {
      return null;
    }
  }

  private async confirmedOrInvalid(
    response: Response,
    operationKey: string,
    expected: ProviderRenewalPayload,
  ): Promise<ProviderCallOutcome> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: 'invalid_result', errorCode: 'PROVIDER_RESULT_MISMATCH' };
    }
    const operation = this.parseOperation(body, operationKey, expected);
    return operation
      ? { kind: 'confirmed', operation }
      : { kind: 'invalid_result', errorCode: 'PROVIDER_RESULT_MISMATCH' };
  }

  private parseOperation(
    body: unknown,
    operationKey: string,
    expected: ProviderRenewalPayload,
  ): ProviderOperation | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return null;
    }
    const value = body as Record<string, unknown>;
    if (
      ('operation_key' in value && value.operation_key !== operationKey) ||
      value.status !== 'completed' ||
      value.started_count !== 1 ||
      typeof value.operation_id !== 'string' ||
      !value.operation_id.trim() ||
      value.resource_id !== expected.resourceId ||
      value.period_months !== expected.periodMonths ||
      typeof value.amount_minor !== 'number' ||
      !Number.isSafeInteger(value.amount_minor) ||
      value.amount_minor < 0 ||
      BigInt(value.amount_minor) !== expected.amountMinor ||
      value.currency !== expected.currency
    ) {
      return null;
    }
    return {
      operationId: value.operation_id,
      status: 'completed',
      startedCount: 1,
      resourceId: expected.resourceId,
      periodMonths: expected.periodMonths,
      amountMinor: value.amount_minor,
      currency: expected.currency,
    };
  }
}
