import { Inject, Injectable } from '@nestjs/common';
import { and, or } from '@prisma/orm-postgres/orm-client';
import { DB } from '../database/database.module.js';
import type { Db } from '../prisma/db.js';
import type { ListUsersQuery } from './dto/list-users.schema.js';
import type { Role } from './role.js';

/** Escapes LIKE wildcards so a search for "50%" matches literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Columns safe to return to clients. `passwordHash` is deliberately absent. */
export const PUBLIC_USER_FIELDS = [
  'id',
  'email',
  'fullName',
  'role',
  'isActive',
  'lastLoginAt',
  'createdAt',
  'updatedAt',
] as const;

export interface NewUser {
  email: string;
  fullName: string;
  passwordHash: string;
  role: Role;
}

/** Thrown when the email is already registered (unique constraint `users_email_key`). */
export class EmailAlreadyExistsError extends Error {
  constructor(readonly email: string) {
    super(`A user with email ${email} already exists`);
    this.name = 'EmailAlreadyExistsError';
  }
}

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { sqlState?: unknown; constraint?: unknown };
  return e.sqlState === UNIQUE_VIOLATION && e.constraint === constraint;
}

/** Data-access layer for users: the only place that talks to the `users` table. */
@Injectable()
export class UsersRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(data: NewUser) {
    try {
      return await this.db.orm.public.User.select(...PUBLIC_USER_FIELDS).create(data);
    } catch (err) {
      // Rely on the unique index rather than a SELECT-then-INSERT check, which
      // two concurrent requests could both pass.
      if (isUniqueViolation(err, 'users_email_key')) throw new EmailAlreadyExistsError(data.email);
      throw err;
    }
  }

  /** Newest first, filtered by role and/or a case-insensitive email/name search. */
  async list(query: ListUsersQuery) {
    const pattern = query.search ? `%${escapeLike(query.search)}%` : undefined;
    const filtered = this.db.orm.public.User.where((u) =>
      and(
        query.role ? u.role.eq(query.role) : u.id.isNotNull(),
        pattern ? or(u.email.ilike(pattern), u.fullName.ilike(pattern)) : u.id.isNotNull(),
      ),
    );
    const [items, totals] = await Promise.all([
      filtered
        .select(...PUBLIC_USER_FIELDS)
        .orderBy((u) => u.createdAt.desc())
        .limit(query.limit)
        .offset(query.offset)
        .all()
        .toArray(),
      filtered.aggregate((a) => ({ total: a.count() })),
    ]);
    return { items, total: totals.total, limit: query.limit, offset: query.offset };
  }

  async findById(id: string) {
    return await this.db.orm.public.User.select(...PUBLIC_USER_FIELDS).where({ id }).first();
  }

  /** Includes `passwordHash`; for the login check only — never return this to a client. */
  async findCredentialsByEmail(email: string) {
    return await this.db.orm.public.User.select('id', 'passwordHash', 'isActive')
      .where({ email })
      .first();
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.db.orm.public.User.where({ id }).updateAndCount({ lastLoginAt: new Date() });
  }

  /**
   * Changes the role only if the user currently has `from` and is active, in a
   * single UPDATE, so two admins acting at once cannot both apply it.
   * Returns the updated user, or null when no row matched.
   */
  async changeRoleIf(id: string, from: Role, to: Role) {
    return await this.db.orm.public.User.select(...PUBLIC_USER_FIELDS)
      .where({ id, role: from, isActive: true })
      .update({ role: to });
  }

  /**
   * Deactivates or reactivates a non-admin user, only if it isn't already in
   * that state, in one transaction. Deactivating also revokes every session,
   * so no refresh token of theirs works any more. Returns the updated user,
   * or null when no row matched (missing, an admin, or already in that state).
   */
  async setActiveIf(id: string, active: boolean) {
    return await this.db.transaction(async (tx) => {
      const user = await tx.orm.public.User.select(...PUBLIC_USER_FIELDS)
        .where({ id, isActive: !active })
        .where((u) => u.role.neq('ADMIN'))
        .update({ isActive: active });
      if (user && !active) {
        await tx.orm.public.Session.where({ userId: id })
          .where((s) => s.revokedAt.isNull())
          .updateAndCount({ revokedAt: new Date() });
      }
      return user;
    });
  }

  /**
   * Makes the user with this email an active ADMIN, creating it if missing.
   * An existing user's password is left unchanged. Used by the seed command.
   */
  async ensureAdmin(data: Omit<NewUser, 'role'>) {
    const existing = await this.db.orm.public.User.select(...PUBLIC_USER_FIELDS)
      .where({ email: data.email })
      .update({ role: 'ADMIN', isActive: true });
    if (existing) return { user: existing, created: false };
    return { user: await this.create({ ...data, role: 'ADMIN' }), created: true };
  }
}

export type PublicUser = NonNullable<Awaited<ReturnType<UsersRepository['findById']>>>;
