import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthContext } from './auth.types.js';

const CSRF_PURPOSE = 'resource-renewal/csrf-v1';
const CSRF_HEX_PATTERN = /^[0-9a-f]{64}$/;

@Injectable()
export class CsrfService {
  private readonly secret: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.secret = config.getOrThrow<string>('CSRF_SECRET');
  }

  create(context: Pick<AuthContext, 'sessionId' | 'tokenHash'>): string {
    return createHmac('sha256', this.secret)
      .update(`${CSRF_PURPOSE}:${context.sessionId}:${context.tokenHash}`, 'utf8')
      .digest('hex');
  }

  verify(context: AuthContext, candidate: string | undefined): boolean {
    if (!candidate || !CSRF_HEX_PATTERN.test(candidate)) {
      return false;
    }
    const expected = Buffer.from(this.create(context), 'hex');
    const actual = Buffer.from(candidate, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
