import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { QueueSignal } from '../requests/queue-signal.js';
import type { RequestChanges, RequestsRepository } from '../requests/requests.repository.js';
import type { RequestsService } from '../requests/requests.service.js';
import type { Status } from '../requests/request-rules.js';
import { STEPS } from './job-steps.js';
import type { ClaimedJob, JobsRepository } from './jobs.repository.js';
import { WorkerService } from './worker.service.js';

interface FakeRequest {
  id: string;
  status: Status;
  priority: string;
  category: 'VM_PROVISIONING' | 'ACCESS_RESET';
  progress: number;
  currentStep: string | null;
  version: number;
  startedAt: Date | null;
  result?: unknown;
  errorReason?: string | null;
  payload: { target: string };
}
interface FakeJob {
  id: string;
  requestId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  attempt: number;
  maxAttempts: number;
  lockToken: string | null;
  notBefore: number;
  claimedBy?: string;
}

/**
 * An in-memory queue with the same rules as the real one: claiming is a
 * compare-and-set on status, ownership is checked through the lock token, and
 * worker changes only apply while the request is in the expected status.
 */
class FakeDb {
  requests = new Map<string, FakeRequest>();
  jobs: FakeJob[] = [];
  events: { requestId: string; message: string; eventType: string }[] = [];
  /** How many jobs were RUNNING at once, at most. */
  peakRunning = 0;
  private seq = 0;

  addRequest(id: string, over: Partial<FakeRequest> = {}) {
    this.requests.set(id, {
      id, status: 'PENDING', priority: 'MEDIUM', category: 'ACCESS_RESET', progress: 0, currentStep: null,
      version: 1, startedAt: null, payload: { target: 'jdoe' }, ...over,
    });
    this.jobs.push({ id: `job-${id}`, requestId: id, status: 'QUEUED', attempt: 1, maxAttempts: 3, lockToken: null, notBefore: 0 });
  }

  jobsRepo(): JobsRepository {
    const owned = (j: ClaimedJob) => this.jobs.find((x) => x.id === j.id && x.lockToken === j.lockToken && x.status === 'RUNNING');
    const rank: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
    return {
      claimNext: async (workerId: string) => {
        await Promise.resolve(); // let other workers interleave, as with a real database
        const candidates = this.jobs
          .filter((j) => j.status === 'QUEUED' && j.notBefore <= Date.now())
          .sort((a, b) => rank[this.requests.get(b.requestId)!.priority]! - rank[this.requests.get(a.requestId)!.priority]!);
        for (const c of candidates) {
          if (c.status !== 'QUEUED') continue; // compare-and-set
          c.status = 'RUNNING';
          c.lockToken = `t${++this.seq}`;
          c.claimedBy = workerId;
          this.peakRunning = Math.max(this.peakRunning, this.jobs.filter((j) => j.status === 'RUNNING').length);
          return { id: c.id, requestId: c.requestId, attempt: c.attempt, maxAttempts: c.maxAttempts, lockToken: c.lockToken };
        }
        return null;
      },
      heartbeat: async (j: ClaimedJob) => !!owned(j),
      finish: async (j: ClaimedJob, status: FakeJob['status']) => {
        const job = owned(j);
        if (job) job.status = status;
        return !!job;
      },
      release: async (j: ClaimedJob) => {
        const job = owned(j);
        if (job) Object.assign(job, { status: 'QUEUED', lockToken: null });
      },
      setProgress: async () => undefined,
      enqueueRetry: async (requestId: string, attempt: number, maxAttempts: number, notBefore: Date) => {
        this.jobs.push({ id: `job-${requestId}-${attempt}`, requestId, status: 'QUEUED', attempt, maxAttempts, lockToken: null, notBefore: notBefore.getTime() });
      },
      takeExpired: async () => [],
      enqueueOrphans: async () => 0,
      countByStatus: async () => ({}),
    } as unknown as JobsRepository;
  }

  requestsRepo(): RequestsRepository {
    return {
      findById: async (id: string) => (this.requests.has(id) ? { ...this.requests.get(id)! } : null),
      applyWorkerChange: async (
        id: string,
        whileStatus: readonly Status[],
        changes: RequestChanges,
        event: { message: string; eventType: string },
        bumpVersion: boolean,
      ) => {
        const r = this.requests.get(id);
        if (!r || !whileStatus.includes(r.status)) return null;
        Object.assign(r, changes);
        if (bumpVersion) r.version++;
        this.events.push({ requestId: id, message: event.message, eventType: event.eventType });
        return `e${++this.seq}`;
      },
    } as unknown as RequestsRepository;
  }
}

function makeWorker(db: FakeDb, settings: Partial<Record<string, number | boolean>> = {}) {
  const values: Record<string, number | boolean> = {
    WORKER_ENABLED: true, WORKER_CONCURRENCY: 2, WORKER_POLL_MS: 50, WORKER_LEASE_SECONDS: 30,
    WORKER_MAX_ATTEMPTS: 3, WORKER_STEP_MS: 2, WORKER_FAILURE_RATE: 0, ...settings,
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService<Env, true>;
  const publish = vi.fn().mockResolvedValue(null);
  const worker = new WorkerService(
    db.jobsRepo(),
    db.requestsRepo(),
    { publish } as unknown as RequestsService,
    new QueueSignal(),
    config,
  );
  return { worker, publish };
}

/** Runs the pool until the queue is drained. */
async function drain(...workers: WorkerService[]) {
  for (let i = 0; i < 200; i++) {
    await Promise.all(workers.map((w) => w.fill()));
    await new Promise((r) => setTimeout(r, 5));
    if (workers.every((w) => w.status().busy === 0)) {
      await Promise.all(workers.map((w) => w.fill()));
      if (workers.every((w) => w.status().busy === 0)) return;
    }
  }
  throw new Error('queue did not drain');
}

describe('WorkerService', () => {
  it('processes a request step by step and completes it with a result', async () => {
    const db = new FakeDb();
    db.addRequest('r1', { category: 'VM_PROVISIONING' });
    const { worker, publish } = makeWorker(db);
    await drain(worker);

    const r = db.requests.get('r1')!;
    expect(r).toMatchObject({ status: 'COMPLETED', progress: 100, currentStep: null });
    expect(r.result).toMatchObject({ hostname: 'jdoe', vcpus: 4 });
    expect(r.version).toBe(3); // PENDING→IN_PROGRESS and →COMPLETED bump; progress ticks don't
    expect(db.jobs[0]!.status).toBe('SUCCEEDED');

    const messages = db.events.map((e) => e.message);
    expect(messages[0]).toMatch(/^Picked up by CPU-1 \(attempt 1 of 3\)$/);
    expect(messages).toHaveLength(STEPS.VM_PROVISIONING.length + 1); // pick-up, steps 1..n-1, completion
    expect(messages.at(-1)).toMatch(/^Completed by CPU-1/);
    expect(publish).toHaveBeenCalledTimes(messages.length); // every change pushed live
  });

  it('runs up to WORKER_CONCURRENCY jobs at the same time, never more', async () => {
    const db = new FakeDb();
    for (let i = 0; i < 7; i++) db.addRequest(`r${i}`);
    const { worker } = makeWorker(db, { WORKER_CONCURRENCY: 3 });
    await drain(worker);

    expect(db.peakRunning).toBe(3);
    expect([...db.requests.values()].every((r) => r.status === 'COMPLETED')).toBe(true);
  });

  it('two worker pools sharing a queue never process the same request twice', async () => {
    const db = new FakeDb();
    for (let i = 0; i < 10; i++) db.addRequest(`r${i}`);
    const a = makeWorker(db, { WORKER_CONCURRENCY: 3 }).worker;
    const b = makeWorker(db, { WORKER_CONCURRENCY: 3 }).worker;
    await drain(a, b);

    for (const id of db.requests.keys()) {
      const pickups = db.events.filter((e) => e.requestId === id && e.message.startsWith('Picked up'));
      expect(pickups).toHaveLength(1);
    }
    expect(db.jobs.every((j) => j.status === 'SUCCEEDED')).toBe(true);
  });

  it('picks higher priority requests first', async () => {
    const db = new FakeDb();
    db.addRequest('low', { priority: 'LOW' });
    db.addRequest('critical', { priority: 'CRITICAL' });
    db.addRequest('high', { priority: 'HIGH' });
    const { worker } = makeWorker(db, { WORKER_CONCURRENCY: 1 });
    await drain(worker);

    const order = db.events.filter((e) => e.message.startsWith('Picked up')).map((e) => e.requestId);
    expect(order).toEqual(['critical', 'high', 'low']);
  });

  it('stops at the next step when the request is cancelled mid-run', async () => {
    const db = new FakeDb();
    db.addRequest('r1');
    const { worker } = makeWorker(db, { WORKER_STEP_MS: 20 });
    await worker.fill();
    await new Promise((r) => setTimeout(r, 15));
    db.requests.get('r1')!.status = 'CANCELLED'; // a person cancelled it
    await drain(worker);

    expect(db.requests.get('r1')!.status).toBe('CANCELLED');
    expect(db.jobs[0]!.status).toBe('CANCELLED');
    expect(db.events.some((e) => e.message.startsWith('Completed'))).toBe(false);
  });

  it('retries a failed attempt with backoff, then marks the request FAILED after the last one', async () => {
    const db = new FakeDb();
    db.addRequest('r1');
    const { worker } = makeWorker(db);
    const job = (attempt: number): ClaimedJob => ({ id: `job-r1`, requestId: 'r1', attempt, maxAttempts: 3, lockToken: 'x' });
    db.requests.get('r1')!.status = 'IN_PROGRESS';

    await worker.handleFailure(job(1), 'Target host unreachable');
    const retry = db.jobs.find((j) => j.attempt === 2)!;
    expect(retry.status).toBe('QUEUED');
    expect(retry.notBefore - Date.now()).toBeGreaterThan(1500); // backoff
    expect(db.requests.get('r1')!.currentStep).toBe('Retrying in 2s (attempt 2 of 3)');

    await worker.handleFailure(job(3), 'Target host unreachable');
    expect(db.requests.get('r1')).toMatchObject({ status: 'FAILED', errorReason: 'Target host unreachable' });
    expect(db.events.at(-1)!.message).toMatch(/Attempt 3 of 3 failed: .* No attempts left/);
    await worker.onApplicationShutdown(); // clear the backoff timer
  });

  it('a simulated step failure goes through the retry path', async () => {
    const db = new FakeDb();
    db.addRequest('r1');
    const { worker } = makeWorker(db, { WORKER_FAILURE_RATE: 1 });
    await worker.fill();
    await new Promise((r) => setTimeout(r, 30));

    expect(db.jobs[0]!.status).toBe('FAILED');
    expect(db.jobs[1]).toMatchObject({ attempt: 2, status: 'QUEUED' });
    expect(db.events.at(-1)!.message).toMatch(/Attempt 1 of 3 failed: Verifying account: .*Retrying in 2s/);
    await worker.onApplicationShutdown();
  });

  it('on shutdown, puts running jobs back in the queue instead of losing them', async () => {
    const db = new FakeDb();
    db.addRequest('r1');
    const { worker } = makeWorker(db, { WORKER_STEP_MS: 1000 });
    await worker.fill();
    await new Promise((r) => setTimeout(r, 10));
    await worker.onApplicationShutdown();

    expect(db.jobs[0]).toMatchObject({ status: 'QUEUED', lockToken: null });
    expect(db.requests.get('r1')!.currentStep).toBe('Waiting for a worker');
    expect(worker.status().busy).toBe(0);
  });

  it('stops quietly if it loses its lease (another worker took the job over)', async () => {
    const db = new FakeDb();
    db.addRequest('r1');
    const { worker } = makeWorker(db, { WORKER_STEP_MS: 20 });
    await worker.fill();
    db.jobs[0]!.lockToken = 'reaper'; // reaped while this worker stalled
    await new Promise((r) => setTimeout(r, 40));

    expect(db.requests.get('r1')!.status).toBe('IN_PROGRESS'); // not completed by the stale worker
    expect(worker.status().busy).toBe(0);
  });

  it('does nothing when disabled', async () => {
    const db = new FakeDb();
    db.addRequest('r1');
    const { worker } = makeWorker(db, { WORKER_ENABLED: false });
    worker.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 20));
    expect(db.requests.get('r1')!.status).toBe('PENDING');
  });
});
