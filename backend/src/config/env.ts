/** Environment variables the app needs, after validation. */
export interface Env {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  DATABASE_URL: string;
  /** How long a login session (bearer token) stays valid. */
  SESSION_TTL_HOURS: number;
}

const NODE_ENVS = ['development', 'production', 'test'] as const;

/**
 * Validates `process.env` (plus `.env`) at startup, so a missing or malformed
 * setting stops the app immediately with a clear message instead of failing
 * on the first request. Passed to `ConfigModule.forRoot({ validate })`.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const errors: string[] = [];

  const nodeEnv = (raw.NODE_ENV ?? 'development') as Env['NODE_ENV'];
  if (!NODE_ENVS.includes(nodeEnv)) errors.push(`NODE_ENV must be one of ${NODE_ENVS.join(', ')}`);

  const port = Number(raw.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT must be an integer 1-65535');

  const databaseUrl = raw.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL must be a postgres:// or postgresql:// connection string');
  }

  const sessionTtl = Number(raw.SESSION_TTL_HOURS ?? 8);
  if (!Number.isFinite(sessionTtl) || sessionTtl <= 0 || sessionTtl > 24 * 30) {
    errors.push('SESSION_TTL_HOURS must be a number of hours between 0 and 720');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n  - ${errors.join('\n  - ')}`);
  }
  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: databaseUrl as string,
    SESSION_TTL_HOURS: sessionTtl,
  };
}
