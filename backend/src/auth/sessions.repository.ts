import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module.js';
import type { Db } from '../prisma/db.js';

export interface NewSession {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  remember: boolean;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Data-access layer for login sessions (`sessions` table). A session is the
 * server-side half of a login: it holds the hash of the current refresh token,
 * so it can be revoked (logout) or rotated (refresh).
 */
@Injectable()
export class SessionsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(s: NewSession) {
    return await this.db.orm.public.Session.select('id', 'expiresAt', 'remember').create({
      userId: s.userId,
      refreshTokenHash: s.refreshTokenHash,
      expiresAt: s.expiresAt,
      remember: s.remember,
      userAgent: s.userAgent ?? null,
      ipAddress: s.ipAddress ?? null,
    });
  }

  /** The unrevoked, unexpired session holding this refresh token, with its user. */
  async findActiveByRefreshHash(refreshTokenHash: string, now: Date) {
    return await this.db.orm.public.Session.select('id', 'expiresAt', 'refreshTokenHash', 'remember')
      .where((s) => s.refreshTokenHash.eq(refreshTokenHash))
      .where((s) => s.revokedAt.isNull())
      .where((s) => s.expiresAt.gt(now))
      .include('user', (u) => u.select('id', 'email', 'fullName', 'role', 'isActive'))
      .first();
  }

  /**
   * Swaps the refresh token, but only if it is still `currentHash`. If two
   * requests race to refresh with the same token, only one wins; the other
   * gets null (and a 401), so a stolen-and-replayed token can't be reused.
   */
  async rotate(id: string, currentHash: string, nextHash: string): Promise<boolean> {
    const n = await this.db.orm.public.Session.where({ id, refreshTokenHash: currentHash })
      .where((s) => s.revokedAt.isNull())
      .updateAndCount({ refreshTokenHash: nextHash });
    return n > 0;
  }

  async revoke(id: string): Promise<void> {
    await this.db.orm.public.Session.where({ id })
      .where((s) => s.revokedAt.isNull())
      .updateAndCount({ revokedAt: new Date() });
  }

  async revokeByRefreshHash(refreshTokenHash: string): Promise<void> {
    await this.db.orm.public.Session.where((s) => s.refreshTokenHash.eq(refreshTokenHash))
      .where((s) => s.revokedAt.isNull())
      .updateAndCount({ revokedAt: new Date() });
  }
}
