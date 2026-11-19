import { validateEnv } from './env.js';

describe('validateEnv', () => {
  const url = 'postgresql://u:p@localhost:5432/db';

  it('applies defaults', () => {
    expect(validateEnv({ DATABASE_URL: url })).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_URL: url,
      SESSION_TTL_HOURS: 8,
    });
  });

  it('parses PORT as a number', () => {
    expect(validateEnv({ DATABASE_URL: url, PORT: '8080' }).PORT).toBe(8080);
  });

  it('lists every problem in one error', () => {
    expect(() => validateEnv({ PORT: 'abc', NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV must be one of[\s\S]*PORT must be[\s\S]*DATABASE_URL must be/,
    );
  });
});
