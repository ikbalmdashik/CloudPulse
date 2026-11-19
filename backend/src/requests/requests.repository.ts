import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, or } from '@prisma/orm-postgres/orm-client';
import { DB } from '../database/database.module.js';
import type { Db } from '../prisma/db.js';
import type { Category, Priority, Status } from './request-rules.js';
import type { ListRequestsQuery } from './dto/request.schemas.js';

/** Columns returned to clients for a request. */
export const REQUEST_FIELDS = [
  'id',
  'code',
  'title',
  'description',
  'category',
  'priority',
  'status',
  'progress',
  'currentStep',
  'payload',
  'errorReason',
  'version',
  'operatorId',
  'createdAt',
  'updatedAt',
  'startedAt',
  'completedAt',
] as const;

const EVENT_FIELDS = ['id', 'eventType', 'fromStatus', 'toStatus', 'progress', 'message', 'createdAt'] as const;

/** A JSON value, as stored in the jsonb columns. */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

export interface NewRequest {
  title: string;
  description: string | null;
  category: Category;
  priority: Priority;
  payload: { readonly [key: string]: Json } | null;
  operatorId: string;
  idempotencyKey: string | null;
}

/** Fields an update may set. `version` is bumped automatically. */
export interface RequestChanges {
  status?: Status;
  progress?: number;
  currentStep?: string | null;
  priority?: Priority;
  errorReason?: string | null;
  startedAt?: Date;
  completedAt?: Date;
}

export interface NewEvent {
  actorId: string;
  eventType: 'created' | 'status_changed' | 'progress_updated' | 'updated' | 'note' | 'cancelled';
  fromStatus?: Status | null;
  toStatus?: Status | null;
  progress?: number | null;
  message: string;
  metadata?: { readonly [key: string]: Json } | null;
}

/** Thrown when a create reused an Idempotency-Key that already made a request. */
export class DuplicateIdempotencyKeyError extends Error {
  constructor(readonly key: string) {
    super('Idempotency-Key already used');
  }
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { sqlState?: unknown; constraint?: unknown };
  return e.sqlState === '23505' && e.constraint === constraint;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// No 0/O/1/I, so codes are easy to read out over the phone.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A human-friendly reference such as `REQ-261119-7KQ2`. */
export function generateRequestCode(now = new Date()): string {
  const date = now.toISOString().slice(2, 10).replaceAll('-', '');
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `REQ-${date}-${suffix}`;
}

/** Data-access layer for service requests and their event timeline. */
@Injectable()
export class RequestsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Inserts the request and its "created" event in one transaction. Returns the new id. */
  async create(data: NewRequest, event: Omit<NewEvent, 'eventType'>): Promise<string> {
    // The code is random; on the rare collision with an existing one, try another.
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.transaction(async (tx) => {
          const created = await tx.orm.public.Request.select('id', 'status').create({
            ...data,
            code: generateRequestCode(),
          });
          await tx.orm.public.RequestEvent.create({
            requestId: created.id,
            actorId: event.actorId,
            eventType: 'created',
            fromStatus: null,
            toStatus: created.status,
            progress: 0,
            message: event.message,
            metadata: event.metadata ?? null,
          });
          return created.id;
        });
      } catch (err) {
        if (isUniqueViolation(err, 'requests_code_key') && attempt < 5) continue;
        if (data.idempotencyKey && isUniqueViolation(err, 'requests_idempotency_key_key')) {
          throw new DuplicateIdempotencyKeyError(data.idempotencyKey);
        }
        throw err;
      }
    }
  }

  async findByIdempotencyKey(key: string) {
    return await this.db.orm.public.Request.select('id', 'operatorId').where({ idempotencyKey: key }).first();
  }

  /** One request with its submitter; null if missing or soft-deleted. */
  async findById(id: string) {
    return await this.db.orm.public.Request.select(...REQUEST_FIELDS)
      .where({ id })
      .where((r) => r.deletedAt.isNull())
      .include('operator', (u) => u.select('id', 'fullName', 'email'))
      .first();
  }

  /** The request's timeline, oldest first, with who did each step. */
  async findEvents(requestId: string) {
    return await this.db.orm.public.RequestEvent.select(...EVENT_FIELDS)
      .where({ requestId })
      .include('actor', (u) => u.select('id', 'fullName', 'role'))
      .orderBy((e) => e.createdAt.asc())
      .all()
      .toArray();
  }

  async findEvent(id: string) {
    return await this.db.orm.public.RequestEvent.select(...EVENT_FIELDS)
      .where({ id })
      .include('actor', (u) => u.select('id', 'fullName', 'role'))
      .first();
  }

  /** Newest first. `operatorId` limits the list to one submitter's requests. */
  async list(query: ListRequestsQuery, operatorId?: string) {
    const pattern = query.search ? `%${escapeLike(query.search)}%` : undefined;
    const filtered = this.db.orm.public.Request.where((r) =>
      and(
        r.deletedAt.isNull(),
        operatorId ? r.operatorId.eq(operatorId) : r.id.isNotNull(),
        query.status ? r.status.eq(query.status) : r.id.isNotNull(),
        query.category ? r.category.eq(query.category) : r.id.isNotNull(),
        query.priority ? r.priority.eq(query.priority) : r.id.isNotNull(),
        query.active ? r.status.in(['PENDING', 'IN_PROGRESS']) : r.id.isNotNull(),
        pattern ? or(r.code.ilike(pattern), r.title.ilike(pattern)) : r.id.isNotNull(),
      ),
    );
    const [items, totals] = await Promise.all([
      filtered
        .select(...REQUEST_FIELDS)
        .include('operator', (u) => u.select('id', 'fullName', 'email'))
        .orderBy((r) => r.createdAt.desc())
        .limit(query.limit)
        .offset(query.offset)
        .all()
        .toArray(),
      filtered.aggregate((a) => ({ total: a.count() })),
    ]);
    return { items, total: totals.total, limit: query.limit, offset: query.offset };
  }

  /**
   * Applies `changes` only if the request is still at `expectedVersion`
   * (optimistic locking), bumps the version and records the event — all in one
   * transaction. Returns the new event's id, or null if the version moved on
   * (someone else changed the request first).
   */
  async updateIfVersion(
    id: string,
    expectedVersion: number,
    changes: RequestChanges,
    event: NewEvent,
  ): Promise<string | null> {
    return await this.db.transaction(async (tx) => {
      const updated = await tx.orm.public.Request.select('id')
        .where({ id, version: expectedVersion })
        .where((r) => r.deletedAt.isNull())
        .update({ ...changes, version: expectedVersion + 1 });
      if (!updated) return null;
      const created = await tx.orm.public.RequestEvent.select('id').create({
        requestId: id,
        actorId: event.actorId,
        eventType: event.eventType,
        fromStatus: event.fromStatus ?? null,
        toStatus: event.toStatus ?? null,
        progress: event.progress ?? null,
        message: event.message,
        metadata: event.metadata ?? null,
      });
      return created.id;
    });
  }
}

export type RequestRow = NonNullable<Awaited<ReturnType<RequestsRepository['findById']>>>;
export type RequestEventRow = NonNullable<Awaited<ReturnType<RequestsRepository['findEvent']>>>;
