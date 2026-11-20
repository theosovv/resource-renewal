export interface AppEnvironment {
  DATABASE_URL: string;
  API_HOST: string;
  API_PORT: number;
  WEB_ORIGIN: string;
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

  return {
    DATABASE_URL: databaseUrl,
    API_HOST: readString(config, 'API_HOST', '127.0.0.1'),
    API_PORT: readPort(config.API_PORT),
    WEB_ORIGIN: webOrigin,
  };
}
