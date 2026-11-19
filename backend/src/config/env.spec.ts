import { validateEnv } from './env.js';

describe('validateEnv', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_SECRET: 'x'.repeat(32) };

  it('applies defaults', () => {
    expect(validateEnv(base)).toEqual({
      ...base,
      NODE_ENV: 'development',
      PORT: 4000,
      ACCESS_TOKEN_TTL_MINUTES: 10,
      SESSION_TTL_HOURS: 8,
      REMEMBER_ME_DAYS: 30,
      WORKER_ENABLED: true,
      WORKER_CONCURRENCY: 4,
      WORKER_POLL_MS: 1000,
      WORKER_LEASE_SECONDS: 30,
      WORKER_MAX_ATTEMPTS: 3,
      WORKER_STEP_MS: 2000,
      WORKER_FAILURE_RATE: 0.03,
      FRONTEND_ORIGIN: 'http://localhost:3000',
    });
  });

  it('parses numbers from strings', () => {
    const env = validateEnv({ ...base, PORT: '8080', ACCESS_TOKEN_TTL_MINUTES: '5' });
    expect(env.PORT).toBe(8080);
    expect(env.ACCESS_TOKEN_TTL_MINUTES).toBe(5);
  });

  it('lists every problem in one error', () => {
    expect(() => validateEnv({ PORT: 'abc', NODE_ENV: 'staging', JWT_SECRET: 'short' })).toThrow(
      /NODE_ENV must be one of[\s\S]*PORT must be[\s\S]*DATABASE_URL is required[\s\S]*JWT_SECRET must be at least 32/,
    );
  });
});
