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
});
