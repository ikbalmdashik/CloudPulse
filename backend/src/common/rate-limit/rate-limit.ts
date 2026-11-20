import { UseGuards, applyDecorators } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Env } from '../../config/env.js';

/** The client's IP address, as Express resolved it (see `trust proxy` in main.ts). */
function clientIp(req: Record<string, any>): string {
  return String(req.ip ?? req.socket?.remoteAddress ?? 'unknown');
}

/** The email in the request body, normalized, or '' when there is none. */
function bodyEmail(req: Record<string, any>): string {
  const email = req.body?.email;
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
}

/**
 * Rate limits for the password routes (login and sign-up), slowing down
 * password guessing and mass sign-ups:
 *
 *  - `account`: attempts per IP address *and* email. Stops guessing one
 *    account's password, without letting an attacker lock that account out for
 *    everyone else (a different IP still gets its own allowance).
 *  - `ip`: all such requests per IP address, whatever the email, so one client
 *    can't spray many accounts.
 *
 * Over the limit the API answers 429 with a Retry-After header. Counters live
 * in memory, per server instance; several instances would share a store such
 * as Redis instead.
 */
export function rateLimitOptions(config: ConfigService<Env, true>): ThrottlerModuleOptions {
  const enabled = config.get('RATE_LIMIT_ENABLED', { infer: true });
  return {
    skipIf: () => !enabled,
    errorMessage: 'Too many attempts. Please wait a minute and try again.',
    throttlers: [
      {
        name: 'account',
        ttl: 60_000,
        limit: config.get('LOGIN_ATTEMPTS_PER_MINUTE', { infer: true }),
        getTracker: (req) => `${clientIp(req)}|${bodyEmail(req)}`,
      },
      {
        name: 'ip',
        ttl: 60_000,
        limit: config.get('AUTH_REQUESTS_PER_MINUTE', { infer: true }),
        getTracker: (req) => clientIp(req),
      },
    ],
  };
}

/** Apply to a route to rate-limit it with the limits above. */
export const RateLimited = () => applyDecorators(UseGuards(ThrottlerGuard));
