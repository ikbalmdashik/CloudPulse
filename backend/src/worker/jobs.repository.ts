import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { or } from '@prisma/orm-postgres/orm-client';
import { DB } from '../database/database.module.js';
import type { Db } from '../prisma/db.js';
import { PRIORITIES, type Priority } from '../requests/request-rules.js';

export const JOB_FIELDS = [
  'id',
  'requestId',
  'workerId',
  'lockToken',
  'lockedUntil',
  'status',
  'attempt',
  'maxAttempts',
  'queuedAt',
  'startedAt',
  'finishedAt',
] as const;

/** A job this worker has claimed. `lockToken` proves it still owns the job. */
export interface ClaimedJob {
  id: string;
  requestId: string;
  attempt: number;
  maxAttempts: number;
  lockToken: string;
}

/** Higher number = picked first. */
const PRIORITY_RANK: Record<Priority, number> = Object.fromEntries(PRIORITIES.map((p, i) => [p, i])) as Record<
  Priority,
  number
>;

/**
 * The job queue, stored in `execution_jobs`. Postgres is the source of truth,
 * so any number of workers (in one process or many) can share it safely.
 *
 * Job states: QUEUED → RUNNING → SUCCEEDED | FAILED | CANCELLED.
 * For a QUEUED job, `lockedUntil` means "not before" (retry backoff); for a
 * RUNNING job it is the lease that its worker keeps renewing.
 */
@Injectable()
export class JobsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Claims the most urgent available job: highest request priority, then
   * oldest. The claim is a compare-and-set (`UPDATE … WHERE status = 'QUEUED'`),
   * so when several workers race for the same job exactly one wins and the
   * others move on to the next candidate. Returns null if nothing is available.
   */
  async claimNext(workerId: string, leaseMs: number, now = new Date()): Promise<ClaimedJob | null> {
    const candidates = await this.db.orm.public.ExecutionJob.select('id', 'requestId', 'attempt', 'maxAttempts', 'queuedAt')
      .where({ status: 'QUEUED' })
      .where((j) => or(j.lockedUntil.isNull(), j.lockedUntil.lte(now)))
      .include('request', (r) => r.select('priority'))
      .orderBy((j) => j.queuedAt.asc())
      .limit(50)
      .all()
      .toArray();

    candidates.sort(
      (a, b) => PRIORITY_RANK[b.request?.priority ?? 'LOW'] - PRIORITY_RANK[a.request?.priority ?? 'LOW'],
    ); // stable: equal priorities keep queue order

    for (const c of candidates) {
      const lockToken = randomUUID();
      const claimed = await this.db.orm.public.ExecutionJob.select('id')
        .where({ id: c.id, status: 'QUEUED' })
        .update({
          status: 'RUNNING',
          workerId,
          lockToken,
          lockedUntil: new Date(now.getTime() + leaseMs),
          startedAt: now,
        });
      if (claimed) return { id: c.id, requestId: c.requestId, attempt: c.attempt, maxAttempts: c.maxAttempts, lockToken };
      // Another worker got it first; try the next one.
    }
    return null;
  }

  /** Renews the lease. False if this worker no longer owns the job (it was reaped or cancelled). */
  async heartbeat(job: ClaimedJob, leaseMs: number): Promise<boolean> {
    const n = await this.db.orm.public.ExecutionJob.where({ id: job.id, lockToken: job.lockToken, status: 'RUNNING' })
      .updateAndCount({ lockedUntil: new Date(Date.now() + leaseMs) });
    return n > 0;
  }

  /** Ends a job this worker owns. False if it no longer owned it. */
  async finish(
    job: ClaimedJob,
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
    logs?: string,
  ): Promise<boolean> {
    const n = await this.db.orm.public.ExecutionJob.where({ id: job.id, lockToken: job.lockToken, status: 'RUNNING' })
      .updateAndCount({ status, finishedAt: new Date(), lockedUntil: null, progress: status === 'SUCCEEDED' ? 100 : undefined, logs: logs ?? null });
    return n > 0;
  }

  /** Puts a job this worker owns back in the queue unchanged (used on shutdown). */
  async release(job: ClaimedJob): Promise<void> {
    await this.db.orm.public.ExecutionJob.where({ id: job.id, lockToken: job.lockToken, status: 'RUNNING' })
      .updateAndCount({ status: 'QUEUED', workerId: null, lockToken: null, lockedUntil: null, startedAt: null });
  }

  async setProgress(job: ClaimedJob, progress: number): Promise<void> {
    await this.db.orm.public.ExecutionJob.where({ id: job.id, lockToken: job.lockToken }).updateAndCount({ progress });
  }

  /** Queues the next attempt, available from `notBefore` (retry backoff). */
  async enqueueRetry(requestId: string, attempt: number, maxAttempts: number, notBefore: Date): Promise<void> {
    await this.db.orm.public.ExecutionJob.create({ requestId, attempt, maxAttempts, lockedUntil: notBefore });
  }

  /**
   * Running jobs whose lease ran out: their worker crashed or hung. Each is
   * taken over with a compare-and-set, so only one reaper handles it.
   */
  async takeExpired(now = new Date()): Promise<ClaimedJob[]> {
    const expired = await this.db.orm.public.ExecutionJob.select('id', 'requestId', 'attempt', 'maxAttempts', 'lockToken')
      .where({ status: 'RUNNING' })
      .where((j) => j.lockedUntil.lt(now))
      .limit(20)
      .all()
      .toArray();
    const taken: ClaimedJob[] = [];
    for (const j of expired) {
      const lockToken = randomUUID();
      const n = await this.db.orm.public.ExecutionJob.where({ id: j.id, status: 'RUNNING', lockToken: j.lockToken ?? '' })
        .updateAndCount({ lockToken, workerId: 'reaper' });
      if (n > 0) taken.push({ id: j.id, requestId: j.requestId, attempt: j.attempt, maxAttempts: j.maxAttempts, lockToken });
    }
    return taken;
  }

  /**
   * Queues a job for every unfinished request that has none (e.g. requests
   * created before the workers existed). Safe to run concurrently: the
   * one-active-job-per-request index rejects duplicates. Returns how many.
   */
  async enqueueOrphans(maxAttempts: number): Promise<number> {
    const unfinished = await this.db.orm.public.Request.select('id')
      .where((r) => r.status.in(['PENDING', 'IN_PROGRESS']))
      .where((r) => r.deletedAt.isNull())
      .include('jobs', (j) => j.select('id').where((x) => x.status.in(['QUEUED', 'RUNNING'])))
      .all()
      .toArray();
    let queued = 0;
    for (const r of unfinished.filter((r) => r.jobs.length === 0)) {
      try {
        await this.db.orm.public.ExecutionJob.create({ requestId: r.id, attempt: 1, maxAttempts });
        queued++;
      } catch (err) {
        const e = err as { sqlState?: string };
        if (e.sqlState !== '23505') throw err; // someone else queued it first
      }
    }
    return queued;
  }

  /** Counts jobs by status, for the queue panel. */
  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.db.orm.public.ExecutionJob.groupBy('status').aggregate((a) => ({ count: a.count() }));
    return Object.fromEntries(rows.map((r) => [r.status, r.count]));
  }
}
