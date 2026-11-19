import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Env } from '../config/env.js';
import { hashPassword } from '../users/password.js';
import type { UsersRepository } from '../users/users.repository.js';
import type { AuthUser } from './auth-user.js';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators.js';
import { AuthGuard } from './guards/auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import type { SessionsRepository } from './sessions.repository.js';
import { hashToken } from './token.js';

const config = { get: () => 8 } as unknown as ConfigService<Env, true>;
const meta = { userAgent: 'vitest', ipAddress: '127.0.0.1' };
const profile = { id: 'u1', email: 'a@b.io', fullName: 'Alice', role: 'OPERATOR' as const };

describe('AuthService', () => {
  let passwordHash: string;
  beforeAll(async () => {
    passwordHash = await hashPassword('secret123');
  });

  function setup(opts: { creds?: object | null; session?: object | null } = {}) {
    const users = {
      findCredentialsByEmail: vi.fn().mockResolvedValue(
        opts.creds === undefined ? { id: 'u1', passwordHash, isActive: true } : opts.creds,
      ),
      touchLastLogin: vi.fn(),
      findById: vi.fn().mockResolvedValue({ ...profile, isActive: true }),
    };
    const sessions = {
      create: vi.fn(async (s: { expiresAt: Date }) => ({ id: 's1', expiresAt: s.expiresAt })),
      findActive: vi.fn().mockResolvedValue(opts.session ?? null),
      revoke: vi.fn(),
      revokeByTokenHash: vi.fn(),
    };
    const service = new AuthService(
      users as unknown as UsersRepository,
      sessions as unknown as SessionsRepository,
      config,
    );
    return { service, users, sessions };
  }

  it('logs in: stores only the token hash and returns the token once', async () => {
    const { service, sessions, users } = setup();
    const result = await service.login({ email: 'a@b.io', password: 'secret123' }, meta);

    expect(result).toMatchObject({ tokenType: 'Bearer', user: profile });
    expect(result.accessToken).toMatch(/^[\w-]{43}$/);
    const stored = sessions.create.mock.calls[0]![0] as { tokenHash: string; expiresAt: Date };
    expect(stored.tokenHash).toBe(hashToken(result.accessToken));
    expect(stored.tokenHash).not.toContain(result.accessToken);
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(7.9 * 3600_000);
    expect(users.touchLastLogin).toHaveBeenCalledWith('u1');
  });

  it('ends the session the browser already had', async () => {
    const { service, sessions } = setup();
    await service.login({ email: 'a@b.io', password: 'secret123' }, meta, 'old-token');
    expect(sessions.revokeByTokenHash).toHaveBeenCalledWith(hashToken('old-token'));
  });

  it('keeps the old session when the new login fails', async () => {
    const { service, sessions } = setup();
    await service.login({ email: 'a@b.io', password: 'wrong123' }, meta, 'old-token').catch(() => undefined);
    expect(sessions.revokeByTokenHash).not.toHaveBeenCalled();
  });

  it('rejects a wrong password with the same message as an unknown email', async () => {
    const wrong = await setup().service.login({ email: 'a@b.io', password: 'nope1234' }, meta).catch((e) => e);
    const unknown = await setup({ creds: null }).service.login({ email: 'x@y.io', password: 'secret123' }, meta).catch((e) => e);
    expect(wrong).toBeInstanceOf(UnauthorizedException);
    expect(unknown).toBeInstanceOf(UnauthorizedException);
    expect(wrong.message).toBe(unknown.message);
  });

  it('refuses a deactivated account after a correct password', async () => {
    const { service, sessions } = setup({ creds: { id: 'u1', passwordHash, isActive: false } });
    await expect(service.login({ email: 'a@b.io', password: 'secret123' }, meta)).rejects.toBeInstanceOf(ForbiddenException);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('authenticates a live session by token hash', async () => {
    const { service, sessions } = setup({ session: { id: 's1', user: { ...profile, isActive: true } } });
    await expect(service.authenticate('tok')).resolves.toEqual({ ...profile, sessionId: 's1' });
    expect(sessions.findActive).toHaveBeenCalledWith(hashToken('tok'), expect.any(Date));
  });

  it('rejects an unknown session or a deactivated user', async () => {
    await expect(setup().service.authenticate('tok')).resolves.toBeNull();
    const inactive = setup({ session: { id: 's1', user: { ...profile, isActive: false } } });
    await expect(inactive.service.authenticate('tok')).resolves.toBeNull();
  });
});

function ctx(req: object, meta: Record<string, unknown> = {}) {
  const handler = () => undefined;
  for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const user: AuthUser = { ...profile, sessionId: 's1' };
  const auth = { authenticate: vi.fn(async (t: string) => (t === 'good' ? user : null)) };
  const guard = new AuthGuard(new Reflector(), auth as unknown as AuthService);

  it('lets @Public routes through without a token', async () => {
    await expect(guard.canActivate(ctx({ headers: {} }, { [IS_PUBLIC_KEY]: true }))).resolves.toBe(true);
  });

  it('requires a session everywhere else', async () => {
    await expect(guard.canActivate(ctx({ headers: {} }))).rejects.toThrow('Not logged in');
    await expect(guard.canActivate(ctx({ headers: { authorization: 'Basic x' } }))).rejects.toThrow('Not logged in');
    await expect(guard.canActivate(ctx({ headers: { cookie: 'other=good' } }))).rejects.toThrow('Not logged in');
    await expect(guard.canActivate(ctx({ headers: { authorization: 'Bearer bad' } }))).rejects.toThrow('Invalid or expired');
  });

  it.each([
    ['a bearer token', { authorization: 'Bearer good' }],
    ['the session cookie', { cookie: 'theme=dark; cp_session=good; x=1' }],
  ])('attaches the user for %s', async (_label, headers) => {
    const req: { headers: object; user?: AuthUser } = { headers };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.user).toBe(user);
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const as = (role: string) => ({ user: { role } });

  it('allows routes without @Roles', () => {
    expect(guard.canActivate(ctx(as('OPERATOR')))).toBe(true);
  });

  it('allows a matching role and forbids others', () => {
    const adminOnly = { [ROLES_KEY]: ['ADMIN'] };
    expect(guard.canActivate(ctx(as('ADMIN'), adminOnly))).toBe(true);
    expect(() => guard.canActivate(ctx(as('SUPERVISOR'), adminOnly))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(as('OPERATOR'), adminOnly))).toThrow(ForbiddenException);
  });
});
