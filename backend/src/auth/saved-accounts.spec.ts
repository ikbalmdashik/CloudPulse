import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.js';
import type { UsersRepository } from '../users/users.repository.js';
import { AuthController } from './auth.controller.js';
import type { AuthService, IssuedTokens } from './auth.service.js';
import { ACCOUNTS_COOKIE, readSavedAccounts, refreshCookieName } from './session-cookie.js';

// Valid-looking user ids (the cookie parser only accepts UUIDs).
const id = (n: number) => `00000000-0000-7000-8000-00000000000${n}`;
const A = id(1);
const B = id(2);
const C = id(3);
const user = (uid: string) => ({ id: uid, email: `${uid.slice(-1)}@x.io`, fullName: `User ${uid.slice(-1)}`, role: 'OPERATOR' as const });

/** A browser cookie jar: applies each response's Set-Cookie / clear calls. */
class Browser {
  jar = new Map<string, string>();
  /** Whether each cookie was set with an expiry date (survives restarts) or as a session cookie. */
  persistent = new Map<string, boolean>();
  req(): Request {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
    return { headers: { cookie }, ip: '127.0.0.1' } as unknown as Request;
  }
  res(): Response {
    return {
      cookie: (name: string, value: string, options: { expires?: Date }) => {
        this.jar.set(name, value);
        this.persistent.set(name, !!options?.expires);
      },
      clearCookie: (name: string) => this.jar.delete(name),
    } as unknown as Response;
  }
  get order() {
    return readSavedAccounts(this.req().headers.cookie).order;
  }
}

function setup() {
  let n = 0;
  /** Sessions the fake server considers live, by refresh token. */
  const live = new Map<string, string>(); // refresh token → user id
  const remembered = new Map<string, boolean>(); // refresh token → remember me
  const issue = (uid: string, remember = false): IssuedTokens => {
    const refreshToken = `rt-${uid.slice(-1)}-${++n}`;
    live.set(refreshToken, uid);
    remembered.set(refreshToken, remember);
    return {
      remember,
      accessToken: `at-${uid.slice(-1)}-${n}`,
      accessTokenExpiresAt: new Date(Date.now() + 600_000),
      refreshToken,
      sessionExpiresAt: new Date(Date.now() + 3_600_000),
      user: user(uid),
    };
  };
  const emails: Record<string, string> = { 'a@x.io': A, 'b@x.io': B, 'c@x.io': C };
  const auth = {
    login: vi.fn(async (dto: { email: string; rememberMe: boolean }) =>
      issue(emails[dto.email] ?? id(Number(dto.email[0])), dto.rememberMe),
    ),
    refresh: vi.fn(async (token: string) => {
      const uid = live.get(token);
      if (!uid) throw new UnauthorizedException('Session expired');
      live.delete(token); // rotation: each refresh token works once
      return issue(uid, remembered.get(token));
    }),
    describeSession: vi.fn(async (token: string) => (live.has(token) ? user(live.get(token)!) : null)),
    logoutByRefreshToken: vi.fn(async (token: string) => void live.delete(token)),
    verifyAccessToken: vi.fn(),
    logout: vi.fn(),
  };
  const config = { get: () => 'development' } as unknown as ConfigService<Env, true>;
  const controller = new AuthController(auth as unknown as AuthService, {} as UsersRepository, config);
  const browser = new Browser();
  const login = (email: string, rememberMe = false) =>
    controller.login({ email, password: 'x', rememberMe }, browser.req(), browser.res());
  return { controller, auth, browser, live, login };
}

describe('saved accounts', () => {
  it('keeps every account signed in and makes the newest login active', async () => {
    const { browser, login, live } = setup();
    await login('a@x.io');
    await login('b@x.io');
    await login('c@x.io');

    expect(browser.order).toEqual([C, B, A]);
    expect(browser.jar.get('cp_access')).toMatch(/^at-3-/);
    expect(live.size).toBe(3); // A's and B's sessions were not ended
  });

  it('lists accounts most recently used first, with the active one flagged', async () => {
    const { controller, browser, login } = setup();
    await login('a@x.io');
    await login('b@x.io');

    const list = await controller.accounts(browser.req(), browser.res());
    expect(list.map((a) => [a.id, a.active])).toEqual([
      [B, true],
      [A, false],
    ]);
  });

  it('switches without a password and remembers it as the last used', async () => {
    const { controller, browser, login, auth } = setup();
    await login('a@x.io');
    await login('b@x.io');

    const res = await controller.switch({ userId: A }, browser.req(), browser.res());
    expect(res.user.id).toBe(A);
    expect(auth.login).toHaveBeenCalledTimes(2); // no new password check
    expect(browser.order).toEqual([A, B]);
    expect(browser.jar.get('cp_access')).toMatch(/^at-1-/);
  });

  it("can't switch to an account that isn't saved here", async () => {
    const { controller, browser, login } = setup();
    await login('a@x.io');
    await expect(controller.switch({ userId: C }, browser.req(), browser.res())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('forgets an account whose session has ended when switching to it', async () => {
    const { controller, browser, login, live } = setup();
    await login('a@x.io');
    await login('b@x.io');
    live.delete(browser.jar.get(refreshCookieName(A))!); // A's session expired server-side

    await expect(controller.switch({ userId: A }, browser.req(), browser.res())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(browser.order).toEqual([B]);
    expect(browser.jar.get('cp_access')).toMatch(/^at-2-/); // still using B
  });

  it('logging out signs out only the active account', async () => {
    const { controller, browser, login, live } = setup();
    await login('a@x.io');
    await login('b@x.io');

    await controller.logout(browser.req(), browser.res());
    expect(browser.order).toEqual([A]);
    expect(browser.jar.has('cp_access')).toBe(false); // the user picks the next account
    expect([...live.values()]).toEqual([A]);
  });

  it('can sign out one account, or all of them', async () => {
    const { controller, browser, login, live } = setup();
    await login('a@x.io');
    await login('b@x.io');
    await login('c@x.io');

    await controller.logoutAccount(B, browser.req(), browser.res());
    expect(browser.order).toEqual([C, A]);
    expect(browser.jar.get('cp_access')).toMatch(/^at-3-/); // C is still active

    await controller.logoutAll(browser.req(), browser.res());
    expect(browser.order).toEqual([]);
    expect(browser.jar.has(ACCOUNTS_COOKIE)).toBe(false);
    expect(live.size).toBe(0);
  });

  it('logging in again as a saved account replaces its old session', async () => {
    const { browser, login, live } = setup();
    await login('a@x.io');
    const first = browser.jar.get(refreshCookieName(A))!;
    await login('b@x.io');
    await login('a@x.io');

    expect(live.has(first)).toBe(false);
    expect(browser.order).toEqual([A, B]);
  });

  it('keeps at most 5 accounts, signing out the least recently used', async () => {
    const { browser, login, live } = setup();
    for (const n of [1, 2, 3, 4, 5, 6]) await login(`${n}@x.io`);

    expect(browser.order).toEqual([id(6), id(5), id(4), id(3), id(2)]);
    expect([...live.values()]).not.toContain(id(1));
    expect(browser.jar.has(refreshCookieName(id(1)))).toBe(false);
  });

  it('prunes accounts whose sessions ended when listing', async () => {
    const { controller, browser, login, live } = setup();
    await login('a@x.io');
    await login('b@x.io');
    live.delete(browser.jar.get(refreshCookieName(B))!); // the active account's session ended

    const list = await controller.accounts(browser.req(), browser.res());
    expect(list.map((a) => a.id)).toEqual([A]);
    expect(browser.order).toEqual([A]);
    expect(browser.jar.has('cp_access')).toBe(false); // B's access token goes with it
  });

  it('refresh renews the active account only', async () => {
    const { controller, browser, login } = setup();
    await login('a@x.io');
    await login('b@x.io');
    const res = await controller.refresh({}, browser.req(), browser.res());
    expect(res.user.id).toBe(B);
    expect(browser.order).toEqual([B, A]);
  });

  it('Remember me: cookies survive browser restarts; otherwise they last until it closes', async () => {
    const { controller, browser, login } = setup();
    await login('a@x.io', true);
    await login('b@x.io', false);

    expect(browser.persistent.get(refreshCookieName(A))).toBe(true);
    expect(browser.persistent.get(refreshCookieName(B))).toBe(false);
    expect(browser.persistent.get('cp_access')).toBe(false); // B is active

    // Switching to A (remembered) and refreshing keep A's choice.
    await controller.switch({ userId: A }, browser.req(), browser.res());
    await controller.refresh({}, browser.req(), browser.res());
    expect(browser.persistent.get(refreshCookieName(A))).toBe(true);
    expect(browser.persistent.get('cp_access')).toBe(true);
  });

  it('ignores tampered account lists', () => {
    const cookie = `${ACCOUNTS_COOKIE}=not-an-id.${A}; ${refreshCookieName(A)}=rt`;
    expect(readSavedAccounts(cookie).order).toEqual([A]);
  });
});
