import * as z from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'], { error: 'must be one of development, production, test' })
    .default('development'),
  PORT: z.coerce
    .number({ error: 'must be a number' })
    .int({ error: 'must be an integer 1-65535' })
    .min(1, { error: 'must be an integer 1-65535' })
    .max(65535, { error: 'must be an integer 1-65535' })
    .default(4000),
  DATABASE_URL: z
    .string({ error: 'is required' })
    .regex(/^postgres(ql)?:\/\//, { error: 'must be a postgres:// or postgresql:// connection string' }),

  /** HMAC key for signing access tokens (JWTs). Long and random; never commit it. */
  JWT_SECRET: z
    .string({ error: 'is required (a random string of at least 32 characters)' })
    .min(32, { error: 'must be at least 32 characters' }),
  /** Lifetime of an access token. Short, because a JWT can't be revoked before it expires. */
  ACCESS_TOKEN_TTL_MINUTES: z.coerce
    .number({ error: 'must be a number' })
    .min(1, { error: 'must be 1-60 minutes' })
    .max(60, { error: 'must be 1-60 minutes' })
    .default(10),
  /** Lifetime of a login session (its refresh token) without "Remember me". */
  SESSION_TTL_HOURS: z.coerce
    .number({ error: 'must be a number' })
    .gt(0, { error: 'must be between 0 and 720 hours' })
    .max(720, { error: 'must be between 0 and 720 hours' })
    .default(8),
  /** Lifetime of a login session with "Remember me" ticked. */
  REMEMBER_ME_DAYS: z.coerce
    .number({ error: 'must be a number' })
    .int({ error: 'must be a whole number of days' })
    .min(1, { error: 'must be 1-365 days' })
    .max(365, { error: 'must be 1-365 days' })
    .default(30),
  /** Browser origin allowed to open WebSocket connections. */
  FRONTEND_ORIGIN: z.url({ error: 'must be a URL such as http://localhost:3000' }).default('http://localhost:3000'),
});

/** Environment variables the app needs, after validation. */
export type Env = z.infer<typeof envSchema>;

/**
 * Validates `process.env` (plus `.env`) at startup, so a missing or malformed
 * setting stops the app immediately with a clear message instead of failing
 * on the first request. Passed to `ConfigModule.forRoot({ validate })`.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  - ${lines.join('\n  - ')}`);
  }
  return result.data;
}
