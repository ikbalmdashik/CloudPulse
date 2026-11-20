import { Body, Controller, HttpCode, type INestApplication, Post } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { Env } from '../../config/env.js';
import { RateLimited, rateLimitOptions } from './rate-limit.js';

@Controller()
class LoginController {
  @RateLimited()
  @Post('login')
  @HttpCode(200)
  login(@Body() _body: unknown) {
    return { ok: true };
  }
}

async function appWith(settings: Partial<Env>): Promise<INestApplication> {
  const values: Partial<Env> = { RATE_LIMIT_ENABLED: true, LOGIN_ATTEMPTS_PER_MINUTE: 3, AUTH_REQUESTS_PER_MINUTE: 5, ...settings };
  const config = { get: (k: keyof Env) => values[k] } as unknown as ConfigService<Env, true>;
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot(rateLimitOptions(config))],
    controllers: [LoginController],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

const attempt = (app: INestApplication, email: string) =>
  request(app.getHttpServer()).post('/login').send({ email, password: 'x' });

describe('login rate limiting', () => {
  let app: INestApplication;
  afterEach(() => app?.close());

  it('stops repeated attempts on one account from one IP, with Retry-After', async () => {
    app = await appWith({});
    for (let i = 0; i < 3; i++) expect((await attempt(app, 'ada@x.io')).status).toBe(200);
    const blocked = await attempt(app, 'ADA@x.io '); // same account, differently typed
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/Too many attempts/);
    expect(Number(blocked.headers['retry-after-account'] ?? blocked.headers['retry-after'])).toBeGreaterThan(0);
    // Another account from the same IP still has its own allowance…
    expect((await attempt(app, 'sam@x.io')).status).toBe(200);
  });

  it('caps all attempts from one IP across accounts', async () => {
    app = await appWith({});
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await attempt(app, `user${i}@x.io`)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('can be turned off', async () => {
    app = await appWith({ RATE_LIMIT_ENABLED: false });
    for (let i = 0; i < 8; i++) expect((await attempt(app, 'ada@x.io')).status).toBe(200);
  });
});
