import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module.js';
import type { Db } from '../prisma/db.js';

export interface NewSession {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

/** Data-access layer for login sessions (`sessions` table). */
@Injectable()
export class SessionsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(s: NewSession) {
    return await this.db.orm.public.Session.select('id', 'expiresAt').create({
      userId: s.userId,
      // The column is named refresh_token_hash in the schema; it stores the
      // SHA-256 of the session's bearer token.
      refreshTokenHash: s.tokenHash,
      expiresAt: s.expiresAt,
      userAgent: s.userAgent ?? null,
      ipAddress: s.ipAddress ?? null,
    });
  }

  /** The session for this token hash with its user, if it is unrevoked and unexpired. */
  async findActive(tokenHash: string, now: Date) {
    return await this.db.orm.public.Session.select('id')
      .where((s) => s.refreshTokenHash.eq(tokenHash))
      .where((s) => s.revokedAt.isNull())
      .where((s) => s.expiresAt.gt(now))
      .include('user', (u) => u.select('id', 'email', 'fullName', 'role', 'isActive'))
      .first();
  }

  async revokeByTokenHash(tokenHash: string): Promise<void> {
    await this.db.orm.public.Session.where((s) => s.refreshTokenHash.eq(tokenHash))
      .where((s) => s.revokedAt.isNull())
      .updateAndCount({ revokedAt: new Date() });
  }

  async revoke(id: string): Promise<void> {
    await this.db.orm.public.Session.where({ id })
      .where((s) => s.revokedAt.isNull())
      .updateAndCount({ revokedAt: new Date() });
  }
}
