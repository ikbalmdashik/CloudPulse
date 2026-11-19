import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import { hashPassword } from '../users/password.js';
import type { UsersRepository } from '../users/users.repository.js';
import type { AuthUser } from './auth-user.js';
import { AuthService, JWT_AUDIENCE, JWT_ISSUER } from './auth.service.js';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators.js';
import { AuthGuard } from './guards/auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import type { SessionsRepository } from './sessions.repository.js';
import { readCookie } from './session-cookie.js';
import { hashToken } from './token.js';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const settings: Record<string, number> = { SESSION_TTL_HOURS: 8, ACCESS_TOKEN_TTL_MINUTES: 10, REMEMBER_ME_DAYS: 30 };
const config = { get: (k: string) => settings[k] } as unknown as ConfigService<Env, true>;
const jwt = new JwtService({ secret: SECRET });
const meta = { userAgent: 'vitest', ipAddress: '127.0.0.1' };
const profile = { id: 'u1', email: 'a@b.io', fullName: 'Alice', role: 'OPERATOR' as const };

describe('AuthService', () => {
  let passwordHash: string;
  beforeAll(async () => {
    passwordHash = await hashPassword('secret123');
  });

  function setup(opts: { creds?: object | null; session?: object | null; rotated?: boolean } = {}) {
    const users = {
      findCredentialsByEmail: vi.fn().mockResolvedValue(
        opts.creds === undefined ? { id: 'u1', passwordHash, isActive: true } : opts.creds,
      ),
      touchLastLogin: vi.fn(),
      findById: vi.fn().mockResolvedValue({ ...profile, isActive: true }),
    };
    const sessions = {
      create: vi.fn(async (s: { expiresAt: Date; remember: boolean }) => ({ id: 's1', expiresAt: s.expiresAt, remember: s.remember })),
      findActiveByRefreshHash: vi.fn().mockResolvedValue(opts.session ?? null),
      rotate: vi.fn().mockResolvedValue(opts.rotated ?? true),
      revoke: vi.fn(),
      revokeByRefreshHash: vi.fn(),
    };
    const service = new AuthService(
      users as unknown as UsersRepository,
      sessions as unknown as SessionsRepository,
      jwt,
      config,
    );
    return { service, users, sessions };
  }

  describe('login', () => {
    it('issues a signed JWT access token and stores only the refresh token hash', async () => {
      const { service, sessions } = setup();
      const t = await service.login({ email: 'a@b.io', password: 'secret123', rememberMe: false }, meta);

      const claims = await jwt.verifyAsync(t.accessToken, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
      expect(claims).toMatchObject({ sub: 'u1', sid: 's1', role: 'OPERATOR', email: 'a@b.io', name: 'Alice' });
      expect(claims.exp - claims.iat).toBe(600);

      const stored = sessions.create.mock.calls[0]![0] as unknown as { refreshTokenHash: string };
      expect(stored.refreshTokenHash).toBe(hashToken(t.refreshToken));
      expect(t.refreshToken).toMatch(/^[\w-]{43}$/);
    });

    it('without Remember me: a short session (SESSION_TTL_HOURS)', async () => {
      const { service } = setup();
      const t = await service.login({ email: 'a@b.io', password: 'secret123', rememberMe: false }, meta);
      expect(t.remember).toBe(false);
      expect((t.sessionExpiresAt.getTime() - Date.now()) / 3_600_000).toBeCloseTo(8, 1);
    });

    it('with Remember me: a long session (REMEMBER_ME_DAYS), stored on the session', async () => {
      const { service, sessions } = setup();
      const t = await service.login({ email: 'a@b.io', password: 'secret123', rememberMe: true }, meta);
      expect(t.remember).toBe(true);
      expect((t.sessionExpiresAt.getTime() - Date.now()) / 86_400_000).toBeCloseTo(30, 1);
      expect(sessions.create.mock.calls[0]![0]).toMatchObject({ remember: true });
    });

    it('describes a saved session without rotating it', async () => {
      const live = { id: 's1', user: { ...profile, isActive: true } };
      const { service, sessions } = setup({ session: live });
      await expect(service.describeSession('rt')).resolves.toEqual(profile);
      expect(sessions.rotate).not.toHaveBeenCalled();
      await expect(setup().service.describeSession('dead')).resolves.toBeNull();
    });

    it('rejects a wrong password with the same message as an unknown email', async () => {
      const wrong = await setup().service.login({ email: 'a@b.io', password: 'nope1234', rememberMe: false }, meta).catch((e) => e);
      const unknown = await setup({ creds: null }).service.login({ email: 'x@y.io', password: 'secret123', rememberMe: false }, meta).catch((e) => e);
      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect(wrong.message).toBe(unknown.message);
    });

    it('refuses a deactivated account after a correct password', async () => {
      const { service, sessions } = setup({ creds: { id: 'u1', passwordHash, isActive: false } });
      await expect(service.login({ email: 'a@b.io', password: 'secret123', rememberMe: false }, meta)).rejects.toBeInstanceOf(ForbiddenException);
      expect(sessions.create).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const live = { id: 's1', expiresAt: new Date(Date.now() + 3600_000), remember: true, user: { ...profile, role: 'SUPERVISOR', isActive: true } };

    it('rotates the refresh token and puts the current role in the new access token', async () => {
      const { service, sessions } = setup({ session: live });
      const t = await service.refresh('old-refresh');

      expect(sessions.findActiveByRefreshHash).toHaveBeenCalledWith(hashToken('old-refresh'), expect.any(Date));
      expect(sessions.rotate).toHaveBeenCalledWith('s1', hashToken('old-refresh'), hashToken(t.refreshToken));
      expect(t.refreshToken).not.toBe('old-refresh');
      expect((await service.verifyAccessToken(t.accessToken))?.role).toBe('SUPERVISOR');
      // Rotation keeps the session's expiry and its Remember me choice.
      expect(t.sessionExpiresAt).toBe(live.expiresAt);
      expect(t.remember).toBe(true);
    });

    it('rejects an unknown, expired or revoked refresh token', async () => {
      await expect(setup().service.refresh('nope')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when another request already rotated the same token', async () => {
      await expect(setup({ session: live, rotated: false }).service.refresh('old')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('ends the session of a deactivated user', async () => {
      const { service, sessions } = setup({ session: { ...live, user: { ...live.user, isActive: false } } });
      await expect(service.refresh('old')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessions.revoke).toHaveBeenCalledWith('s1');
    });
  });

  describe('verifyAccessToken', () => {
    const sign = (claims: object, opts: object = {}) =>
      jwt.signAsync(claims, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 60, ...opts });
    const claims = { sub: 'u1', sid: 's1', role: 'OPERATOR', email: 'a@b.io', name: 'Alice' };

    it('returns the user for a valid token', async () => {
      await expect(setup().service.verifyAccessToken(await sign(claims))).resolves.toEqual({
        ...profile,
        sessionId: 's1',
      });
    });

    it.each([
      ['expired', () => sign(claims, { expiresIn: -10 })],
      ['wrong issuer', () => sign(claims, { issuer: 'someone-else' })],
      ['wrong audience', () => sign(claims, { audience: 'other-api' })],
      ['signed with another key', () => new JwtService({ secret: 'x'.repeat(40) }).signAsync(claims, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE })],
      ['tampered', async () => (await sign(claims)).replace(/\.[^.]+\./, `.${Buffer.from(JSON.stringify({ ...claims, role: 'ADMIN' })).toString('base64url')}.`)],
      ['not a JWT', async () => 'garbage'],
    ])('rejects a token that is %s', async (_label, make) => {
      await expect(setup().service.verifyAccessToken(await make())).resolves.toBeNull();
    });
  });
});

function ctx(req: object, metadata: Record<string, unknown> = {}) {
  const handler = () => undefined;
  for (const [k, v] of Object.entries(metadata)) Reflect.defineMetadata(k, v, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const user: AuthUser = { ...profile, sessionId: 's1' };
  const auth = { verifyAccessToken: vi.fn(async (t: string) => (t === 'good' ? user : null)) };
  const guard = new AuthGuard(new Reflector(), auth as unknown as AuthService);

  it('lets @Public routes through without a token', async () => {
    await expect(guard.canActivate(ctx({ headers: {} }, { [IS_PUBLIC_KEY]: true }))).resolves.toBe(true);
  });

  it('requires a valid access token everywhere else', async () => {
    await expect(guard.canActivate(ctx({ headers: {} }))).rejects.toThrow('Not logged in');
    await expect(guard.canActivate(ctx({ headers: { cookie: 'cp_refresh=good' } }))).rejects.toThrow('Not logged in');
    await expect(guard.canActivate(ctx({ headers: { authorization: 'Bearer bad' } }))).rejects.toThrow('invalid or expired');
  });

  it.each([
    ['a bearer token', { authorization: 'Bearer good' }],
    ['the access cookie', { cookie: 'theme=dark; cp_access=good; x=1' }],
  ])('attaches the user for %s', async (_label, headers) => {
    const req: { headers: object; user?: AuthUser } = { headers };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.user).toBe(user);
  });
});

describe('RolesGuard', () => {
  function guardFor(dbUser: object | null) {
    const users = { findById: vi.fn().mockResolvedValue(dbUser) };
    return new RolesGuard(new Reflector(), users as unknown as UsersRepository);
  }
  const adminOnly = { [ROLES_KEY]: ['ADMIN'] };
  const as = (role: string) => ({ user: { id: 'u1', role } });

  it('allows routes without @Roles without a lookup', async () => {
    await expect(guardFor(null).canActivate(ctx(as('OPERATOR')))).resolves.toBe(true);
  });

  it('checks the role in the database, not the one in the token', async () => {
    // Token still says ADMIN, but the user was changed in the database since.
    await expect(guardFor({ role: 'OPERATOR', isActive: true }).canActivate(ctx(as('ADMIN'), adminOnly))).rejects.toThrow(
      ForbiddenException,
    );
    const req = as('OPERATOR');
    await expect(guardFor({ role: 'ADMIN', isActive: true }).canActivate(ctx(req, adminOnly))).resolves.toBe(true);
    expect(req.user.role).toBe('ADMIN');
  });

  it('rejects deactivated users', async () => {
    await expect(guardFor({ role: 'ADMIN', isActive: false }).canActivate(ctx(as('ADMIN'), adminOnly))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('readCookie', () => {
  it('finds one cookie among several', () => {
    expect(readCookie('a=1; cp_access=tok%2Ben; b=2', 'cp_access')).toBe('tok+en');
    expect(readCookie('a=1', 'cp_access')).toBeUndefined();
    expect(readCookie(undefined, 'cp_access')).toBeUndefined();
  });
});
