import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { QueueSignal } from '../requests/queue-signal.js';
import { isFinal } from '../requests/request-rules.js';
import { type NewEvent, type RequestChanges, RequestsRepository } from '../requests/requests.repository.js';
import { RequestsService } from '../requests/requests.service.js';
import type { Status } from '../requests/request-rules.js';
import { failureReason, resultFor, STEPS } from './job-steps.js';
import { type ClaimedJob, JobsRepository } from './jobs.repository.js';

/** The `target` the submitter named (payload is free-form JSON, so check its shape). */
function targetOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const target = (payload as Record<string, unknown>).target;
  return typeof target === 'string' ? target : undefined;
}

/** A simulated step failed; the job is retried if it has attempts left. */
class StepFailure extends Error {}

/** The worker was told to stop (server shutdown); the job goes back in the queue. */
class Stopped extends Error {}

interface Slot {
  name: string;
  job: ClaimedJob;
  abort: AbortController;
  done: Promise<void>;
}

export interface WorkerStatus {
  enabled: boolean;
  concurrency: number;
  busy: number;
  slots: { name: string; requestId: string; attempt: number }[];
}

/**
 * The background worker pool. Runs inside the API process and processes up to
 * WORKER_CONCURRENCY requests at the same time.
 *
 * Concurrency model: Node runs JavaScript on one thread, so each job is an
 * asynchronous task. A job spends its time waiting on I/O (here, simulated
 * with timers; in production, calls to cloud APIs), and while it waits the
 * event loop serves HTTP requests, WebSocket traffic and the other jobs — so
 * long-running work never blocks the API.
 *
 * Safety: every job is claimed with a compare-and-set in Postgres, owned
 * through a lock token and a renewable lease, and every request change is
 * conditional on the request's status. Several worker pools (several server
 * instances) can therefore share one queue without processing a request twice.
 */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private readonly slots = new Map<string, Slot>(); // by job id
  private readonly enabled: boolean;
  private readonly concurrency: number;
  private readonly pollMs: number;
  private readonly leaseMs: number;
  private readonly stepMs: number;
  private readonly failureRate: number;
  private readonly maxAttempts: number;
  private stopping = false;
  private filling = false;
  private timers: NodeJS.Timeout[] = [];
  private unsubscribe?: () => void;

  /** Overridable in tests. */
  random: () => number = Math.random;

  constructor(
    private readonly jobs: JobsRepository,
    private readonly requests: RequestsRepository,
    private readonly requestsService: RequestsService,
    private readonly signal: QueueSignal,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true });
    this.concurrency = config.get('WORKER_CONCURRENCY', { infer: true });
    this.pollMs = config.get('WORKER_POLL_MS', { infer: true });
    this.leaseMs = config.get('WORKER_LEASE_SECONDS', { infer: true }) * 1000;
    this.stepMs = config.get('WORKER_STEP_MS', { infer: true });
    this.failureRate = config.get('WORKER_FAILURE_RATE', { infer: true });
    this.maxAttempts = config.get('WORKER_MAX_ATTEMPTS', { infer: true });
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.unsubscribe = this.signal.subscribe(() => void this.fill());
    this.timers.push(setInterval(() => void this.fill(), this.pollMs));
    this.timers.push(setInterval(() => void this.reap(), Math.max(1000, this.leaseMs / 2)));
    this.logger.log(`Worker pool started: ${this.concurrency} concurrent jobs`);
    void this.recover().then(() => this.fill());
  }

  /** On start: retry jobs left running by a crashed process, and queue unfinished requests that have no job. */
  private async recover(): Promise<void> {
    await this.reap();
    try {
      const queued = await this.jobs.enqueueOrphans(this.maxAttempts);
      if (queued > 0) this.logger.log(`Queued ${queued} unfinished request(s) that had no job`);
    } catch (err) {
      this.logger.error('Could not queue unfinished requests', err instanceof Error ? err.stack : err);
    }
  }

  /**
   * Graceful shutdown: stop taking jobs, interrupt the running ones at their
   * current step and put them back in the queue, so another worker (or this
   * one after a restart) resumes them. Nothing is lost.
   */
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.unsubscribe?.();
    for (const t of this.timers) clearInterval(t);
    for (const slot of this.slots.values()) slot.abort.abort();
    await Promise.allSettled([...this.slots.values()].map((s) => s.done));
  }

  status(): WorkerStatus {
    return {
      enabled: this.enabled,
      concurrency: this.concurrency,
      busy: this.slots.size,
      slots: [...this.slots.values()].map((s) => ({ name: s.name, requestId: s.job.requestId, attempt: s.job.attempt })),
    };
  }

  /** Claims jobs until every slot is busy or the queue is empty. */
  async fill(): Promise<void> {
    if (this.stopping || this.filling) return;
    this.filling = true;
    try {
      while (!this.stopping && this.slots.size < this.concurrency) {
        const name = this.freeSlotName();
        const job = await this.jobs.claimNext(name, this.leaseMs);
        if (!job) break;
        this.start(name, job);
      }
    } catch (err) {
      this.logger.error('Could not claim jobs', err instanceof Error ? err.stack : err);
    } finally {
      this.filling = false;
    }
  }

  /** Takes over jobs whose worker stopped renewing its lease (crashed or hung) and retries them. */
  async reap(): Promise<void> {
    if (this.stopping) return;
    try {
      for (const job of await this.jobs.takeExpired()) {
        this.logger.warn(`Job ${job.id} lost its worker; retrying`);
        await this.handleFailure(job, 'The worker processing it stopped responding');
      }
    } catch (err) {
      this.logger.error('Reaper failed', err instanceof Error ? err.stack : err);
    }
  }

  private start(name: string, job: ClaimedJob): void {
    const abort = new AbortController();
    const slot: Slot = { name, job, abort, done: Promise.resolve() };
    slot.done = this.process(name, job, abort.signal)
      .catch((err: unknown) => this.logger.error(`Job ${job.id} crashed`, err instanceof Error ? err.stack : err))
      .finally(() => {
        this.slots.delete(job.id);
        void this.fill(); // a slot is free: take the next job
      });
    this.slots.set(job.id, slot);
  }

  private freeSlotName(): string {
    const used = new Set([...this.slots.values()].map((s) => s.name));
    for (let i = 1; ; i++) if (!used.has(`CPU-${i}`)) return `CPU-${i}`;
  }

  /** Runs one job from start to finish. */
  async process(name: string, job: ClaimedJob, signal: AbortSignal): Promise<void> {
    const request = await this.requests.findById(job.requestId);
    if (!request || isFinal(request.status)) {
      await this.jobs.finish(job, 'CANCELLED', `Request was ${request?.status ?? 'deleted'} before processing`);
      return;
    }
    const steps = STEPS[request.category];
    const attemptText = `attempt ${job.attempt} of ${job.maxAttempts}`;

    // Pick the request up.
    const started = await this.change(
      job.requestId,
      ['PENDING', 'IN_PROGRESS'],
      {
        status: 'IN_PROGRESS',
        startedAt: request.startedAt ?? new Date(),
        currentStep: steps[0]!,
        progress: 0,
      },
      {
        actorId: null,
        eventType: request.status === 'PENDING' ? 'status_changed' : 'processing',
        fromStatus: request.status === 'PENDING' ? 'PENDING' : null,
        toStatus: request.status === 'PENDING' ? 'IN_PROGRESS' : null,
        progress: 0,
        message: `Picked up by ${name} (${attemptText})`,
      },
      request.status === 'PENDING',
    );
    if (!started) return void (await this.jobs.finish(job, 'CANCELLED', 'Request was cancelled'));

    try {
      for (let i = 0; i < steps.length; i++) {
        await this.sleep(this.stepDuration(), signal);
        // Still ours? If the lease was lost (e.g. this process stalled and the
        // reaper re-queued the job), another worker owns it now: stop quietly.
        if (!(await this.jobs.heartbeat(job, this.leaseMs))) return;
        if (this.random() < this.failureRate) throw new StepFailure(`${steps[i]}: ${failureReason(request.category)}`);

        if (i < steps.length - 1) {
          const progress = Math.round(((i + 1) / steps.length) * 100);
          const ok = await this.change(
            job.requestId,
            ['IN_PROGRESS'],
            { progress, currentStep: steps[i + 1]! },
            { actorId: null, eventType: 'progress_updated', progress, message: `${steps[i]} — done (${progress}%)` },
            false,
          );
          // Cancelled by a person while we worked: stop at this step boundary.
          if (!ok) return void (await this.jobs.finish(job, 'CANCELLED', 'Request was cancelled'));
          await this.jobs.setProgress(job, progress);
        }
      }

      const completed = await this.change(
        job.requestId,
        ['IN_PROGRESS'],
        {
          status: 'COMPLETED',
          progress: 100,
          currentStep: null,
          completedAt: new Date(),
          result: resultFor(request.category, targetOf(request.payload)),
        },
        {
          actorId: null,
          eventType: 'status_changed',
          fromStatus: 'IN_PROGRESS',
          toStatus: 'COMPLETED',
          progress: 100,
          message: `Completed by ${name} (${attemptText})`,
        },
        true,
      );
      await this.jobs.finish(job, completed ? 'SUCCEEDED' : 'CANCELLED', completed ? undefined : 'Request was cancelled');
    } catch (err) {
      if (err instanceof Stopped) {
        await this.jobs.release(job);
        await this.change(
          job.requestId,
          ['IN_PROGRESS'],
          { currentStep: 'Waiting for a worker' },
          { actorId: null, eventType: 'processing', message: `${name} stopped (server shutting down); the job will resume` },
          false,
        );
        return;
      }
      await this.handleFailure(job, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * A failed attempt: retry later with exponential backoff, or, after the
   * last attempt, mark the request FAILED.
   */
  async handleFailure(job: ClaimedJob, reason: string): Promise<void> {
    await this.jobs.finish(job, 'FAILED', reason);
    const failedText = `Attempt ${job.attempt} of ${job.maxAttempts} failed: ${reason}`;

    if (job.attempt < job.maxAttempts) {
      const backoffMs = Math.min(60_000, 2000 * 2 ** (job.attempt - 1));
      const seconds = Math.round(backoffMs / 1000);
      const ok = await this.change(
        job.requestId,
        ['IN_PROGRESS', 'PENDING'],
        { currentStep: `Retrying in ${seconds}s (attempt ${job.attempt + 1} of ${job.maxAttempts})` },
        { actorId: null, eventType: 'processing', message: `${failedText}. Retrying in ${seconds}s.` },
        false,
      );
      if (!ok) return; // cancelled meanwhile: don't queue another attempt
      await this.jobs.enqueueRetry(job.requestId, job.attempt + 1, job.maxAttempts, new Date(Date.now() + backoffMs));
      this.timers.push(setTimeout(() => void this.fill(), backoffMs + 50));
      return;
    }

    await this.change(
      job.requestId,
      ['IN_PROGRESS', 'PENDING'],
      { status: 'FAILED', errorReason: reason, currentStep: null, completedAt: new Date() },
      {
        actorId: null,
        eventType: 'status_changed',
        fromStatus: 'IN_PROGRESS',
        toStatus: 'FAILED',
        message: `${failedText}. No attempts left; marked as failed.`,
        metadata: { errorReason: reason },
      },
      true,
    );
  }

  /** Applies a worker change and pushes it live. False if the request left `whileStatus` (e.g. was cancelled). */
  private async change(
    requestId: string,
    whileStatus: readonly Status[],
    changes: RequestChanges,
    event: NewEvent,
    bumpVersion: boolean,
  ): Promise<boolean> {
    const eventId = await this.requests.applyWorkerChange(requestId, whileStatus, changes, event, bumpVersion);
    if (!eventId) return false;
    await this.requestsService.publish(requestId, eventId);
    return true;
  }

  /** Step length varies ±50% around WORKER_STEP_MS, so concurrent jobs visibly interleave. */
  private stepDuration(): number {
    return Math.round(this.stepMs * (0.5 + this.random()));
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Stopped());
      const t = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => (clearTimeout(t), reject(new Stopped())), { once: true });
    });
  }
}
