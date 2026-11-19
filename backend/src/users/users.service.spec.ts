import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Db } from '../prisma/db.js';
import type { CreateUserDto } from './dto/create-user.schema.js';
import { verifyPassword } from './password.js';
import { EmailAlreadyExistsError, PUBLIC_USER_FIELDS, UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';
import type { RealtimeService } from '../realtime/realtime.service.js';

const dto: CreateUserDto = { email: 'alice@example.com', fullName: 'Alice', password: 'secret123' };

function fakeDb(createImpl: (data: unknown) => Promise<unknown>) {
  const create = vi.fn(createImpl);
  const select = vi.fn(() => ({ create }));
  const db = { orm: { public: { User: { select } } } } as unknown as Db;
  return { db, select, create };
}

describe('UsersRepository.create', () => {
  const newUser = { ...dto, role: 'OPERATOR' as const, passwordHash: 'h' };

  it('selects only public fields', async () => {
    const { db, select } = fakeDb(async () => ({ id: 'u1' }));
    await new UsersRepository(db).create(newUser);
    expect(select).toHaveBeenCalledWith(...PUBLIC_USER_FIELDS);
    expect(PUBLIC_USER_FIELDS).not.toContain('passwordHash');
  });

  it('turns the email unique violation into EmailAlreadyExistsError', async () => {
    const { db } = fakeDb(async () => {
      throw Object.assign(new Error('dup'), { sqlState: '23505', constraint: 'users_email_key' });
    });
    await expect(new UsersRepository(db).create(newUser)).rejects.toBeInstanceOf(EmailAlreadyExistsError);
  });

  it('rethrows other database errors unchanged', async () => {
    const other = Object.assign(new Error('fk'), { sqlState: '23503' });
    const { db } = fakeDb(async () => {
      throw other;
    });
    await expect(new UsersRepository(db).create(newUser)).rejects.toBe(other);
  });
});

const realtime = { userRoleChanged: vi.fn() };

describe('UsersService', () => {
  beforeEach(() => realtime.userRoleChanged.mockClear());

  function setup(repo: Partial<Record<keyof UsersRepository, unknown>>) {
    return new UsersService(repo as unknown as UsersRepository, realtime as unknown as RealtimeService);
  }

  describe('create', () => {
    it('always creates an OPERATOR with a hashed password', async () => {
      const create = vi.fn(async (u: object) => ({ id: 'u1', ...u }));
      await setup({ create }).create(dto);

      const saved = create.mock.calls[0]![0] as Record<string, string>;
      expect(saved).toMatchObject({ email: dto.email, fullName: dto.fullName, role: 'OPERATOR' });
      expect(saved).not.toHaveProperty('password');
      expect(saved.passwordHash).toMatch(/^scrypt\$131072\$8\$1\$/);
      await expect(verifyPassword(dto.password, saved.passwordHash!)).resolves.toBe(true);
      await expect(verifyPassword('wrong-pass1', saved.passwordHash!)).resolves.toBe(false);
    });

    it('maps EmailAlreadyExistsError to 409', async () => {
      const create = vi.fn().mockRejectedValue(new EmailAlreadyExistsError(dto.email));
      await expect(setup({ create }).create(dto)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('changeRole', () => {
    const promote = { role: 'SUPERVISOR' as const };

    it('promotes only from an active OPERATOR', async () => {
      const changeRoleIf = vi.fn().mockResolvedValue({ id: 'u1', role: 'SUPERVISOR' });
      await expect(setup({ changeRoleIf }).changeRole('u1', promote, 'admin')).resolves.toMatchObject({
        role: 'SUPERVISOR',
      });
      expect(changeRoleIf).toHaveBeenCalledWith('u1', 'OPERATOR', 'SUPERVISOR');
      // The user's open tabs are told to pick up their new role.
      expect(realtime.userRoleChanged).toHaveBeenCalledWith('u1');
    });

    it('404s for an unknown user', async () => {
      const service = setup({ changeRoleIf: vi.fn().mockResolvedValue(null), findById: vi.fn().mockResolvedValue(null) });
      await expect(service.changeRole('nope', promote, 'admin')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('demotes only from an active SUPERVISOR', async () => {
      const changeRoleIf = vi.fn().mockResolvedValue({ id: 'u1', role: 'OPERATOR' });
      await expect(
        setup({ changeRoleIf }).changeRole('u1', { role: 'OPERATOR' }, 'admin'),
      ).resolves.toMatchObject({ role: 'OPERATOR' });
      expect(changeRoleIf).toHaveBeenCalledWith('u1', 'SUPERVISOR', 'OPERATOR');
    });

    it.each([
      ['SUPERVISOR', { role: 'SUPERVISOR', isActive: true }, /already SUPERVISOR/],
      ['SUPERVISOR', { role: 'ADMIN', isActive: true }, /Only OPERATOR users .* this user is ADMIN/],
      ['SUPERVISOR', { role: 'OPERATOR', isActive: false }, /deactivated/],
      ['OPERATOR', { role: 'OPERATOR', isActive: true }, /already OPERATOR/],
      ['OPERATOR', { role: 'ADMIN', isActive: true }, /Only SUPERVISOR users .* this user is ADMIN/],
    ] as const)('409s changing to %s when the user is %j', async (target, user, message) => {
      const service = setup({ changeRoleIf: vi.fn().mockResolvedValue(null), findById: vi.fn().mockResolvedValue(user) });
      const err = await service.changeRole('u1', { role: target }, 'admin').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toMatch(message);
    });
  });
});
