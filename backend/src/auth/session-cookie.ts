import type { CookieOptions, Request } from 'express';

/** Short-lived JWT access token for the active account, sent on every request. */
export const ACCESS_COOKIE = 'cp_access';
/**
 * Accounts saved in this browser, as user ids joined by "." — most recently
 * used first. The first one is the active account.
 */
export const ACCOUNTS_COOKIE = 'cp_accounts';
/** Each saved account's refresh token lives in its own cookie. */
export const refreshCookieName = (userId: string) => `cp_rt_${userId}`;
/** Single refresh cookie from before multiple accounts; cleared on sight. */
export const LEGACY_REFRESH_COOKIE = 'cp_refresh';
/** How many accounts one browser keeps signed in. */
export const MAX_SAVED_ACCOUNTS = 5;

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * httpOnly: page scripts can't read it, so an XSS bug can't steal a session.
 * sameSite=lax: other sites can't make the browser send it on POST/PATCH.
 * secure: HTTPS-only outside local development.
 */
export function cookieOptions(expires: Date, production: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: production, path: '/', expires };
}

/**
 * Same, but with no expiry date: a browser-session cookie, deleted when the
 * browser closes. Used when "Remember me" is not ticked.
 */
export function sessionCookieOptions(production: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: production, path: '/' };
}

/** Reads one cookie from a raw `Cookie` header. */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  for (const part of cookieHeader?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      const value = decodeURIComponent(part.slice(eq + 1).trim());
      return value || undefined;
    }
  }
  return undefined;
}

/** The access token from `Authorization: Bearer …` (API clients) or the cookie (browsers). */
export function readAccessToken(req: Pick<Request, 'headers'>): string | undefined {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
  if (scheme === 'Bearer' && token) return token;
  return readCookie(req.headers.cookie, ACCESS_COOKIE);
}

export interface SavedAccounts {
  /** User ids, most recently used first; only ids that still have a refresh cookie. */
  order: string[];
  /** Refresh token per user id. */
  tokens: Map<string, string>;
}

/** The accounts saved in this browser, from the request's cookies. */
export function readSavedAccounts(cookieHeader: string | undefined): SavedAccounts {
  const tokens = new Map<string, string>();
  const listed = (readCookie(cookieHeader, ACCOUNTS_COOKIE) ?? '').split('.').filter((id) => USER_ID.test(id));
  for (const id of new Set(listed)) {
    const token = readCookie(cookieHeader, refreshCookieName(id));
    if (token) tokens.set(id, token);
  }
  return { order: [...tokens.keys()], tokens };
}

export function isUserId(value: string): boolean {
  return USER_ID.test(value);
}
