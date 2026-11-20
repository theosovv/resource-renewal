export interface AppEnvironment {
  DATABASE_URL: string;
  API_HOST: string;
  API_PORT: number;
  WEB_ORIGIN: string;
  COOKIE_SECURE: boolean;
  CSRF_SECRET: string;
  SESSION_IDLE_TTL_SECONDS: number;
  SESSION_ABSOLUTE_TTL_SECONDS: number;
}

function readString(
  config: Record<string, unknown>,
  key: string,
  fallback?: string,
): string {
  const value = config[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`${key} must be a non-empty string`);
}

function readPort(value: unknown): number {
  const raw = typeof value === 'string' && value.trim().length > 0 ? value : '3000';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }
  return port;
}

function readPositiveInteger(value: unknown, key: string, fallback: number): number {
  const raw = value === undefined || value === '' ? String(fallback) : value;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

function readCookieSecure(value: unknown): boolean {
  if (value === undefined || value === '') {
    return true;
  }
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  throw new Error('COOKIE_SECURE must be either true or false');
}

function isExplicitLocalHttpOrigin(origin: URL): boolean {
  return (
    origin.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '::1'].includes(origin.hostname)
  );
}

export function validateEnvironment(config: Record<string, unknown>): AppEnvironment {
  const databaseUrl = readString(config, 'DATABASE_URL');
  const databaseProtocol = new URL(databaseUrl).protocol;
  if (databaseProtocol !== 'postgresql:' && databaseProtocol !== 'postgres:') {
    throw new Error('DATABASE_URL must use the postgresql:// protocol');
  }

  const webOrigin = readString(config, 'WEB_ORIGIN', 'http://127.0.0.1:5173');
  const parsedWebOrigin = new URL(webOrigin);
  if (
    !['http:', 'https:'].includes(parsedWebOrigin.protocol) ||
    parsedWebOrigin.origin !== webOrigin
  ) {
    throw new Error('WEB_ORIGIN must be an HTTP(S) origin without a path or trailing slash');
  }

  const cookieSecure = readCookieSecure(config.COOKIE_SECURE);
  if (!cookieSecure && !isExplicitLocalHttpOrigin(parsedWebOrigin)) {
    throw new Error('COOKIE_SECURE=false is allowed only for an explicit local HTTP WEB_ORIGIN');
  }

  const csrfSecret = readString(config, 'CSRF_SECRET');
  if (Buffer.byteLength(csrfSecret, 'utf8') < 32) {
    throw new Error('CSRF_SECRET must contain at least 32 bytes');
  }

  return {
    DATABASE_URL: databaseUrl,
    API_HOST: readString(config, 'API_HOST', '127.0.0.1'),
    API_PORT: readPort(config.API_PORT),
    WEB_ORIGIN: webOrigin,
    COOKIE_SECURE: cookieSecure,
    CSRF_SECRET: csrfSecret,
    SESSION_IDLE_TTL_SECONDS: readPositiveInteger(
      config.SESSION_IDLE_TTL_SECONDS,
      'SESSION_IDLE_TTL_SECONDS',
      1800,
    ),
    SESSION_ABSOLUTE_TTL_SECONDS: readPositiveInteger(
      config.SESSION_ABSOLUTE_TTL_SECONDS,
      'SESSION_ABSOLUTE_TTL_SECONDS',
      28_800,
    ),
  };
}
