import type { CookieOptions, Request } from 'express';

/** Cookie that carries the session token for browser clients. */
export const SESSION_COOKIE = 'cp_session';

/**
 * httpOnly: page scripts can't read it, so an XSS bug can't steal the session.
 * sameSite=lax: other sites can't make the browser send it on POST/PATCH.
 * secure: HTTPS-only outside local development.
 */
export function sessionCookieOptions(expires: Date, production: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: production, path: '/', expires };
}

/** The session token from `Authorization: Bearer …` (API clients) or the cookie (browsers). */
export function readSessionToken(req: Request): string | undefined {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
  if (scheme === 'Bearer' && token) return token;
  return readSessionCookie(req);
}

/** The session token from the `cp_session` cookie only. */
export function readSessionCookie(req: Request): string | undefined {
  for (const part of req.headers.cookie?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = decodeURIComponent(part.slice(eq + 1).trim());
      return value || undefined;
    }
  }
  return undefined;
}
