import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment.js';

const baseConfig = {
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/resource_renewal',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  CSRF_SECRET: 'test-only-secret-with-at-least-32-bytes',
};

describe('validateEnvironment', () => {
  it('defaults to Secure cookies and documented session lifetimes', () => {
    expect(validateEnvironment(baseConfig)).toMatchObject({
      COOKIE_SECURE: true,
      SESSION_IDLE_TTL_SECONDS: 1800,
      SESSION_ABSOLUTE_TTL_SECONDS: 28_800,
      PROVIDER_BASE_URL: 'http://127.0.0.1:8091',
      PROVIDER_TIMEOUT_MS: 5_000,
      WORKER_ENABLED: true,
      WORKER_POLL_INTERVAL_MS: 1_000,
      RENEWAL_RETRY_DELAY_MS: 15_000,
      RENEWAL_JOB_LEASE_MS: 30_000,
    });
  });

  it('allows insecure cookies only for explicit local HTTP', () => {
    expect(validateEnvironment({ ...baseConfig, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(
      false,
    );
    expect(() =>
      validateEnvironment({
        ...baseConfig,
        WEB_ORIGIN: 'http://example.test',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow('only for an explicit local HTTP');
  });

  it('requires a sufficiently long CSRF secret and positive TTLs', () => {
    expect(() => validateEnvironment({ ...baseConfig, CSRF_SECRET: 'short' })).toThrow(
      'at least 32 bytes',
    );
    expect(() =>
      validateEnvironment({ ...baseConfig, SESSION_IDLE_TTL_SECONDS: '0' }),
    ).toThrow('positive integer');
  });

  it('validates worker booleans, provider origin and the lease/timeout relationship', () => {
    expect(validateEnvironment({ ...baseConfig, WORKER_ENABLED: 'false' }).WORKER_ENABLED).toBe(
      false,
    );
    expect(() => validateEnvironment({ ...baseConfig, WORKER_ENABLED: 'yes' })).toThrow(
      'WORKER_ENABLED must be either true or false',
    );
    expect(() =>
      validateEnvironment({ ...baseConfig, PROVIDER_BASE_URL: 'http://127.0.0.1:8091/api' }),
    ).toThrow('PROVIDER_BASE_URL');
    expect(() =>
      validateEnvironment({
        ...baseConfig,
        PROVIDER_TIMEOUT_MS: 5_000,
        RENEWAL_JOB_LEASE_MS: 5_000,
      }),
    ).toThrow('RENEWAL_JOB_LEASE_MS must be greater than PROVIDER_TIMEOUT_MS');
  });
});
