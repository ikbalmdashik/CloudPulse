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
  /** Run the background worker pool in this process. Off in tests. */
  WORKER_ENABLED: z
    .enum(['true', 'false'], { error: 'must be true or false' })
    .default('true')
    .transform((v) => v === 'true'),
  /** How many requests this process works on at the same time: its CPUs (CPU-1, CPU-2, …). */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1, { error: 'must be 1-20' }).max(20, { error: 'must be 1-20' }).default(4),
  /** How often idle workers look for queued jobs. New requests also wake them at once. */
  WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  /** A running job's lease: if its worker stops renewing it for this long, the job is retried. */
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(5).max(600).default(30),
  /** Attempts per request before it is marked FAILED. */
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  /** Average duration of one simulated processing step. */
  WORKER_STEP_MS: z.coerce.number().int().min(0).max(60_000).default(2000),
  /**
   * Chance that one simulated step fails, to demonstrate retries (0 = never).
   * Per step: with 5-6 steps, 0.03 fails about 15% of attempts.
   */
  WORKER_FAILURE_RATE: z.coerce.number().min(0, { error: 'must be 0-1' }).max(1, { error: 'must be 0-1' }).default(0.03),
  /**
   * Which proxies may tell the API the client's real IP (X-Forwarded-For), in
   * Express "trust proxy" syntax. The default trusts only this machine, where
   * the Next.js server runs in development; Docker uses "loopback, uniquelocal".
   * Rate limiting is per IP, so getting this right matters.
   */
  TRUST_PROXY: z.string().min(1).default('loopback'),
  /** Turns login and sign-up rate limiting on or off. */
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'], { error: 'must be true or false' })
    .default('true')
    .transform((v) => v === 'true'),
  /** Login (or sign-up) attempts per minute for one email from one IP address. */
  LOGIN_ATTEMPTS_PER_MINUTE: z.coerce.number().int().min(1, { error: 'must be 1-1000' }).max(1000, { error: 'must be 1-1000' }).default(5),
  /** Login and sign-up requests per minute from one IP address, across all emails. */
  AUTH_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1, { error: 'must be 1-10000' }).max(10_000, { error: 'must be 1-10000' }).default(20),
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
