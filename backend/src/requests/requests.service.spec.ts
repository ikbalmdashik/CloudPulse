import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../auth/auth-user.js';
import type { Env } from '../config/env.js';
import type { RealtimeService } from '../realtime/realtime.service.js';
import { approveAllSchema, bulkActionSchema, createRequestSchema, listRequestsQuerySchema, updateRequestSchema } from './dto/request.schemas.js';
import { QueueSignal } from './queue-signal.js';
import { canTransition, isFinal, type Status } from './request-rules.js';
import { DuplicateIdempotencyKeyError, generateRequestCode, type RequestsRepository } from './requests.repository.js';
import { RequestsService } from './requests.service.js';

const operator: AuthUser = { id: 'op1', email: 'o@x.io', fullName: 'Otto', role: 'OPERATOR', sessionId: 's1' };
const otherOperator: AuthUser = { ...operator, id: 'op2' };
const supervisor: AuthUser = { id: 'sup1', email: 's@x.io', fullName: 'Sam', role: 'SUPERVISOR', sessionId: 's2' };
const config = { get: () => 3 } as unknown as ConfigService<Env, true>;

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r1',
    code: 'REQ-261119-ABCD',
    title: 'Provision VM',
    status: 'AWAITING_APPROVAL' as Status,
    priority: 'MEDIUM',
    progress: 0,
    currentStep: null,
    version: 1,
    operatorId: 'op1',
    startedAt: null,
    ...over,
  };
}

function setup(current = row()) {
  const repo = {
    create: vi.fn().mockResolvedValue('r1'),
    findById: vi.fn().mockResolvedValue(current),
    findByIdempotencyKey: vi.fn(),
    findEvents: vi.fn().mockResolvedValue([{ id: 'e1', eventType: 'created' }]),
    findEvent: vi.fn().mockResolvedValue({ id: 'e2' }),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    updateIfVersion: vi.fn().mockResolvedValue('e2'),
    findAwaitingApproval: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    countAwaitingApproval: vi.fn().mockResolvedValue(0),
  };
  const realtime = { requestChanged: vi.fn() };
  const queue = new QueueSignal();
  const woken = vi.fn();
  queue.subscribe(woken);
  const service = new RequestsService(
    repo as unknown as RequestsRepository,
    realtime as unknown as RealtimeService,
    queue,
    config,
  );
  return { service, repo, realtime, woken };
}

const conflict = async (p: Promise<unknown>, message: RegExp) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toMatch(message);
};

describe('request lifecycle rules', () => {
  it('allows only forward moves and never leaves a final state', () => {
    expect(canTransition('AWAITING_APPROVAL', 'PENDING')).toBe(true);
    expect(canTransition('AWAITING_APPROVAL', 'REJECTED')).toBe(true);
    expect(canTransition('AWAITING_APPROVAL', 'IN_PROGRESS')).toBe(false); // no processing without approval
    expect(canTransition('PENDING', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(canTransition('PENDING', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(['COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED'].every((s) => isFinal(s as Status))).toBe(true);
  });

  it('generates readable codes', () => {
    expect(generateRequestCode(new Date('2026-11-19T10:00:00Z'))).toMatch(/^REQ-261119-[2-9A-HJ-NP-Z]{4}$/);
  });
});

describe('request schemas', () => {
  it('defaults priority and trims input', () => {
    expect(createRequestSchema.parse({ title: '  Reset VPN  ', category: 'ACCESS_RESET' })).toEqual({
      title: 'Reset VPN',
      category: 'ACCESS_RESET',
      priority: 'MEDIUM',
    });
  });

  it('staff edits need a priority or a note, and no longer accept status/progress', () => {
    expect(updateRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateRequestSchema.safeParse({ version: 1, priority: 'HIGH' }).success).toBe(true);
    expect(updateRequestSchema.safeParse({ version: 1, status: 'COMPLETED' }).success).toBe(false);
    expect(updateRequestSchema.safeParse({ version: 1, progress: 50 }).success).toBe(false);
  });
});

describe('RequestsService', () => {
  describe('create', () => {
    it('stores the request awaiting approval and pushes it live, without queueing it', async () => {
      const { service, repo, realtime, woken } = setup();
      const result = await service.create({ title: 'Provision VM', category: 'VM_PROVISIONING', priority: 'HIGH' }, operator);

      expect(result.created).toBe(true);
      expect(repo.create.mock.calls[0]![0]).toMatchObject({ operatorId: 'op1', priority: 'HIGH', idempotencyKey: null });
      expect(repo.create.mock.calls[0]![1]).toMatchObject({ message: 'Submitted by Otto; awaiting approval' });
      expect(realtime.requestChanged).toHaveBeenCalledWith('op1', { request: result.request, event: { id: 'e1', eventType: 'created' } });
      expect(woken).not.toHaveBeenCalled(); // nothing to process until it's approved
    });

    it('returns the original request when the same Idempotency-Key is retried', async () => {
      const { service, repo, realtime, woken } = setup();
      repo.create.mockRejectedValue(new DuplicateIdempotencyKeyError('key-12345'));
      repo.findByIdempotencyKey.mockResolvedValue({ id: 'r1', operatorId: 'op1' });

      const result = await service.create({ title: 'xxxxx', category: 'AUDIT_REPORT', priority: 'LOW' }, operator, 'key-12345');
      expect(result.created).toBe(false);
      expect(realtime.requestChanged).not.toHaveBeenCalled();
      expect(woken).not.toHaveBeenCalled();
    });

    it("refuses another user's Idempotency-Key", async () => {
      const { service, repo } = setup();
      repo.create.mockRejectedValue(new DuplicateIdempotencyKeyError('key-12345'));
      repo.findByIdempotencyKey.mockResolvedValue({ id: 'r1', operatorId: 'someone-else' });
      await expect(
        service.create({ title: 'xxxxx', category: 'AUDIT_REPORT', priority: 'LOW' }, operator, 'key-12345'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('visibility', () => {
    it('limits operators to their own requests and shows staff everything', async () => {
      const { service, repo } = setup();
      await service.list({ limit: 20, offset: 0 }, operator);
      expect(repo.list).toHaveBeenLastCalledWith({ limit: 20, offset: 0 }, 'op1');
      await service.list({ limit: 20, offset: 0 }, supervisor);
      expect(repo.list).toHaveBeenLastCalledWith({ limit: 20, offset: 0 }, undefined);
    });

    it("hides other operators' requests as 404", async () => {
      await expect(setup().service.get('r1', otherOperator)).rejects.toBeInstanceOf(NotFoundException);
      await expect(setup().service.get('r1', supervisor)).resolves.toMatchObject({ id: 'r1', events: expect.any(Array) });
    });
  });

  describe('update (staff)', () => {
    it('changes priority with a timeline event and pushes it live', async () => {
      const { service, repo, realtime } = setup(row({ status: 'IN_PROGRESS' }));
      await service.update('r1', { version: 1, priority: 'CRITICAL', note: 'Customer escalation' }, supervisor);

      const [, version, changes, event] = repo.updateIfVersion.mock.calls[0]!;
      expect(version).toBe(1);
      expect(changes).toEqual({ priority: 'CRITICAL' });
      expect(event).toMatchObject({
        eventType: 'updated',
        actorId: 'sup1',
        message: 'Priority changed from MEDIUM to CRITICAL · Note: Customer escalation',
      });
      expect(realtime.requestChanged).toHaveBeenCalledWith('op1', expect.objectContaining({ event: { id: 'e2' } }));
    });

    it('adds a note even on a finished request, but not a priority change', async () => {
      const { service, repo } = setup(row({ status: 'COMPLETED' }));
      await service.update('r1', { version: 1, note: 'Verified by customer' }, supervisor);
      expect(repo.updateIfVersion.mock.calls[0]![3]).toMatchObject({ eventType: 'note' });
      await conflict(setup(row({ status: 'COMPLETED' })).service.update('r1', { version: 1, priority: 'HIGH' }, supervisor), /can no longer change/);
    });

    it('rejects a stale version before and during the write', async () => {
      await conflict(setup(row({ version: 2 })).service.update('r1', { version: 1, priority: 'HIGH' }, supervisor), /changed since/);

      const { service, repo, realtime } = setup();
      repo.updateIfVersion.mockResolvedValue(null); // another write won the race
      await conflict(service.update('r1', { version: 1, priority: 'HIGH' }, supervisor), /changed since/);
      expect(realtime.requestChanged).not.toHaveBeenCalled();
    });

    it('rejects an update that changes nothing', async () => {
      await expect(setup().service.update('r1', { version: 1, priority: 'MEDIUM' }, supervisor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('cancel', () => {
    it('lets the submitter cancel an unfinished request and cancels its queued job', async () => {
      const { service, repo } = setup(row({ status: 'IN_PROGRESS' }));
      await service.cancel('r1', { version: 1, reason: 'not needed' }, operator);
      const [, , changes, event, jobs] = repo.updateIfVersion.mock.calls[0]!;
      expect(changes).toMatchObject({ status: 'CANCELLED', completedAt: expect.any(Date) });
      expect(event).toMatchObject({ eventType: 'cancelled', toStatus: 'CANCELLED', message: 'Cancelled by Otto: not needed' });
      expect(jobs).toEqual({ cancelQueued: true });
    });

    it("can't cancel a finished request or someone else's", async () => {
      await conflict(setup(row({ status: 'COMPLETED' })).service.cancel('r1', { version: 1 }, operator), /can't be cancelled/);
      await expect(setup().service.cancel('r1', { version: 1 }, otherOperator)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('approve and reject (staff, four-eyes)', () => {
    const otherAdmin: AuthUser = { id: 'adm1', email: 'a@x.io', fullName: 'Ada', role: 'ADMIN', sessionId: 's3' };

    it('approving queues the request for a CPU and records who approved it', async () => {
      const { service, repo, woken } = setup();
      await service.approve('r1', { version: 1 }, supervisor);
      const [, version, changes, event, jobs] = repo.updateIfVersion.mock.calls[0]!;
      expect(version).toBe(1);
      expect(changes).toMatchObject({ status: 'PENDING', approvedById: 'sup1', approvedAt: expect.any(Date) });
      expect(event).toMatchObject({ eventType: 'approved', fromStatus: 'AWAITING_APPROVAL', toStatus: 'PENDING', message: 'Approved by Sam; queued for processing' });
      expect(jobs).toEqual({ enqueue: { maxAttempts: 3 } });
      expect(woken).toHaveBeenCalledOnce();
    });

    it("staff can't approve or reject a request they submitted themselves", async () => {
      const own = row({ operatorId: 'sup1' });
      await expect(setup(own).service.approve('r1', { version: 1 }, supervisor)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(setup(own).service.reject('r1', { version: 1, reason: 'nope' }, supervisor)).rejects.toBeInstanceOf(ForbiddenException);
      // …but another supervisor or admin can.
      await expect(setup(own).service.approve('r1', { version: 1 }, otherAdmin)).resolves.toBeDefined();
    });

    it('rejecting ends the request with the reason shown to the submitter', async () => {
      const { service, repo, woken } = setup();
      await service.reject('r1', { version: 1, reason: 'Use the self-service portal' }, supervisor);
      const [, , changes, event, jobs] = repo.updateIfVersion.mock.calls[0]!;
      expect(changes).toMatchObject({ status: 'REJECTED', errorReason: 'Use the self-service portal', completedAt: expect.any(Date) });
      expect(event).toMatchObject({ eventType: 'rejected', toStatus: 'REJECTED', message: 'Rejected by Sam: Use the self-service portal' });
      expect(jobs).toBeUndefined();
      expect(woken).not.toHaveBeenCalled();
    });

    it('only requests awaiting approval can be approved or rejected', async () => {
      await conflict(setup(row({ status: 'PENDING' })).service.approve('r1', { version: 1 }, supervisor), /only requests awaiting approval/);
      await conflict(setup(row({ status: 'CANCELLED' })).service.reject('r1', { version: 1, reason: 'late' }, supervisor), /only requests awaiting approval/);
      await conflict(setup(row({ version: 2 })).service.approve('r1', { version: 1 }, supervisor), /changed since/);
    });
  });

  describe('approve all (staff)', () => {
    const asOf = new Date('2026-11-20T10:00:00Z');

    it('approves every matching request, skipping own and changed ones, and wakes a worker once', async () => {
      const { service, repo, woken, realtime } = setup();
      repo.findAwaitingApproval.mockResolvedValue({
        items: [
          { id: 'a', code: 'A', version: 1 },
          { id: 'b', code: 'B', version: 3 },
          { id: 'c', code: 'C', version: 1 },
        ],
        total: 3,
      });
      repo.countAwaitingApproval.mockResolvedValue(5); // 2 of them are the supervisor's own
      repo.updateIfVersion.mockResolvedValueOnce('e1').mockResolvedValueOnce(null).mockResolvedValueOnce('e3');

      const result = await service.approveAll({ since: '5m', asOf }, supervisor);

      expect(result).toEqual({ approved: 2, skippedOwn: 2, skippedChanged: 1, remaining: 0 });
      expect(repo.findAwaitingApproval).toHaveBeenCalledWith(expect.objectContaining({ since: '5m', asOf }), 'sup1', 200);
      const [id, version, changes, event, jobs] = repo.updateIfVersion.mock.calls[1]!;
      expect([id, version]).toEqual(['b', 3]);
      expect(changes).toMatchObject({ status: 'PENDING', approvedById: 'sup1' });
      expect(event).toMatchObject({ eventType: 'approved', fromStatus: 'AWAITING_APPROVAL', toStatus: 'PENDING' });
      expect(jobs).toEqual({ enqueue: { maxAttempts: 3 } });
      expect(realtime.requestChanged).toHaveBeenCalledTimes(2);
      expect(woken).toHaveBeenCalledOnce();
    });

    it('reports what is left beyond the per-call limit, and does nothing when nothing matches', async () => {
      const { service, repo, woken } = setup();
      repo.findAwaitingApproval.mockResolvedValue({ items: [{ id: 'a', code: 'A', version: 1 }], total: 250 });
      repo.countAwaitingApproval.mockResolvedValue(250);
      expect(await service.approveAll({ asOf }, supervisor)).toMatchObject({ approved: 1, remaining: 249 });

      const empty = setup();
      expect(await empty.service.approveAll({ asOf }, supervisor)).toEqual({ approved: 0, skippedOwn: 0, skippedChanged: 0, remaining: 0 });
      expect(empty.repo.updateIfVersion).not.toHaveBeenCalled();
      expect(empty.woken).not.toHaveBeenCalled();
      expect(woken).toHaveBeenCalledOnce();
    });

    it('validates the time window and requires asOf', () => {
      expect(listRequestsQuerySchema.parse({ since: '1h' }).since).toBe('1h');
      expect(listRequestsQuerySchema.safeParse({ since: '2m' }).success).toBe(false);
      expect(approveAllSchema.safeParse({ since: '5m' }).success).toBe(false);
      expect(approveAllSchema.parse({ since: '5m', asOf: '2026-11-20T10:00:00.000Z' }).asOf).toEqual(asOf);
      expect(approveAllSchema.safeParse({ asOf: '2026-11-20T10:00:00Z', status: 'PENDING' }).success).toBe(false);
    });
  });

  describe('bulk actions', () => {
    it('approves each selected request with its own version check, reporting the ones it skips', async () => {
      const { service, repo, woken } = setup();
      const rows: Record<string, ReturnType<typeof row>> = {
        a: row({ id: 'a' }),
        own: row({ id: 'own', operatorId: 'sup1' }),
        stale: row({ id: 'stale', version: 2 }),
      };
      repo.findById.mockImplementation(async (id: string) => rows[id] ?? null);

      const result = await service.bulk(
        { action: 'approve', items: [{ id: 'a', version: 1 }, { id: 'own', version: 1 }, { id: 'stale', version: 1 }, { id: 'gone', version: 1 }] },
        supervisor,
      );

      expect(result.succeeded).toEqual(['a']);
      expect(result.failed.map((f) => [f.id, f.status])).toEqual([
        ['own', 403],
        ['stale', 409],
        ['gone', 404],
      ]);
      expect(repo.updateIfVersion).toHaveBeenCalledOnce();
      expect(woken).toHaveBeenCalledOnce();
    });

    it('rejects with one reason for all, and lets operators cancel only their own', async () => {
      const staff = setup();
      const rejected = await staff.service.bulk({ action: 'reject', items: [{ id: 'r1', version: 1 }], reason: 'Duplicate' }, supervisor);
      expect(rejected.succeeded).toEqual(['r1']);
      expect(staff.repo.updateIfVersion.mock.calls[0]![3]).toMatchObject({ message: 'Rejected by Sam: Duplicate' });

      await expect(setup().service.bulk({ action: 'approve', items: [{ id: 'r1', version: 1 }] }, operator)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect((await setup().service.bulk({ action: 'cancel', items: [{ id: 'r1', version: 1 }] }, operator)).succeeded).toEqual(['r1']);
      const notMine = await setup().service.bulk({ action: 'cancel', items: [{ id: 'r1', version: 1 }] }, otherOperator);
      expect(notMine.failed).toEqual([{ id: 'r1', status: 404, message: 'Request not found' }]);
    });

    it('validates the selection', () => {
      const item = { id: 'r1', version: 1 };
      expect(bulkActionSchema.safeParse({ action: 'approve', items: [item] }).success).toBe(true);
      expect(bulkActionSchema.safeParse({ action: 'reject', items: [item] }).success).toBe(false);
      expect(bulkActionSchema.safeParse({ action: 'approve', items: [] }).success).toBe(false);
      expect(bulkActionSchema.safeParse({ action: 'approve', items: [item, item] }).success).toBe(false);
      expect(bulkActionSchema.safeParse({ action: 'delete', items: [item] }).success).toBe(false);
      const tooMany = Array.from({ length: 101 }, (_, i) => ({ id: `r${i}`, version: 1 }));
      expect(bulkActionSchema.safeParse({ action: 'cancel', items: tooMany }).success).toBe(false);
    });
  });

  describe('retry (staff)', () => {
    it('resets a FAILED request to PENDING, queues a fresh job and wakes a worker', async () => {
      const { service, repo, woken } = setup(row({ status: 'FAILED', progress: 60, errorReason: 'disk full' }));
      await service.retry('r1', { version: 1 }, supervisor);
      const [, , changes, event, jobs] = repo.updateIfVersion.mock.calls[0]!;
      expect(changes).toMatchObject({ status: 'PENDING', progress: 0, errorReason: null, completedAt: null });
      expect(event).toMatchObject({ eventType: 'retried', fromStatus: 'FAILED', toStatus: 'PENDING' });
      expect(jobs).toEqual({ enqueue: { maxAttempts: 3 } });
      expect(woken).toHaveBeenCalledOnce();
    });

    it('only retries FAILED requests', async () => {
      await conflict(setup(row({ status: 'COMPLETED' })).service.retry('r1', { version: 1 }, supervisor), /Only FAILED/);
    });
  });
});
