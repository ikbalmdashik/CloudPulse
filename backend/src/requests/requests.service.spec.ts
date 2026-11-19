import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import type { RealtimeService } from '../realtime/realtime.service.js';
import { createRequestSchema, updateRequestSchema } from './dto/request.schemas.js';
import { canTransition, isFinal, type Status } from './request-rules.js';
import {
  DuplicateIdempotencyKeyError,
  generateRequestCode,
  type RequestsRepository,
} from './requests.repository.js';
import { RequestsService } from './requests.service.js';

const operator: AuthUser = { id: 'op1', email: 'o@x.io', fullName: 'Otto', role: 'OPERATOR', sessionId: 's1' };
const otherOperator: AuthUser = { ...operator, id: 'op2' };
const supervisor: AuthUser = { id: 'sup1', email: 's@x.io', fullName: 'Sam', role: 'SUPERVISOR', sessionId: 's2' };

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r1',
    code: 'REQ-261119-ABCD',
    title: 'Provision VM',
    status: 'PENDING' as Status,
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
  };
  const realtime = { requestChanged: vi.fn() };
  const service = new RequestsService(repo as unknown as RequestsRepository, realtime as unknown as RealtimeService);
  return { service, repo, realtime };
}

const conflict = async (p: Promise<unknown>, message: RegExp) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toMatch(message);
};

describe('request lifecycle rules', () => {
  it('allows only forward moves and never leaves a final state', () => {
    expect(canTransition('PENDING', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(canTransition('PENDING', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(['COMPLETED', 'FAILED', 'CANCELLED'].every((s) => isFinal(s as Status))).toBe(true);
  });

  it('generates readable unique-looking codes', () => {
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

  it('needs a change, and a reason to mark FAILED', () => {
    expect(updateRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    const failed = updateRequestSchema.safeParse({ version: 1, status: 'FAILED' });
    expect(failed.error?.issues[0]?.path).toEqual(['errorReason']);
    expect(updateRequestSchema.safeParse({ version: 1, status: 'FAILED', errorReason: 'disk full' }).success).toBe(true);
  });
});

describe('RequestsService', () => {
  describe('create', () => {
    it('stores the request for the caller and pushes it live', async () => {
      const { service, repo, realtime } = setup();
      const result = await service.create({ title: 'Provision VM', category: 'VM_PROVISIONING', priority: 'HIGH' }, operator);

      expect(result.created).toBe(true);
      expect(repo.create.mock.calls[0]![0]).toMatchObject({ operatorId: 'op1', priority: 'HIGH', idempotencyKey: null });
      expect(realtime.requestChanged).toHaveBeenCalledWith('op1', { request: result.request, event: { id: 'e1', eventType: 'created' } });
    });

    it('returns the original request when the same Idempotency-Key is retried', async () => {
      const { service, repo, realtime } = setup();
      repo.create.mockRejectedValue(new DuplicateIdempotencyKeyError('key-12345'));
      repo.findByIdempotencyKey.mockResolvedValue({ id: 'r1', operatorId: 'op1' });

      const result = await service.create({ title: 'x'.repeat(5), category: 'AUDIT_REPORT', priority: 'LOW' }, operator, 'key-12345');
      expect(result.created).toBe(false);
      expect(realtime.requestChanged).not.toHaveBeenCalled();
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
    it('starts a request: sets startedAt, bumps version through the repo, pushes the change', async () => {
      const { service, repo, realtime } = setup();
      await service.update('r1', { version: 1, status: 'IN_PROGRESS', progress: 10, currentStep: 'Allocating' }, supervisor);

      const [, version, changes, event] = repo.updateIfVersion.mock.calls[0]!;
      expect(version).toBe(1);
      expect(changes).toMatchObject({ status: 'IN_PROGRESS', progress: 10, currentStep: 'Allocating', startedAt: expect.any(Date) });
      expect(event).toMatchObject({ eventType: 'status_changed', fromStatus: 'PENDING', toStatus: 'IN_PROGRESS', actorId: 'sup1' });
      expect(realtime.requestChanged).toHaveBeenCalledWith('op1', expect.objectContaining({ event: { id: 'e2' } }));
    });

    it('completing sets progress 100 and completedAt', async () => {
      const { service, repo } = setup(row({ status: 'IN_PROGRESS', progress: 70 }));
      await service.update('r1', { version: 1, status: 'COMPLETED' }, supervisor);
      expect(repo.updateIfVersion.mock.calls[0]![2]).toMatchObject({ status: 'COMPLETED', progress: 100, completedAt: expect.any(Date) });
    });

    it('rejects a stale version before and during the write', async () => {
      await conflict(setup(row({ version: 2 })).service.update('r1', { version: 1, priority: 'HIGH' }, supervisor), /changed by someone else/);

      const { service, repo, realtime } = setup();
      repo.updateIfVersion.mockResolvedValue(null); // another write won the race
      await conflict(service.update('r1', { version: 1, priority: 'HIGH' }, supervisor), /changed by someone else/);
      expect(realtime.requestChanged).not.toHaveBeenCalled();
    });

    it.each([
      [row({ status: 'PENDING' }), { status: 'COMPLETED' as const }, /from PENDING to COMPLETED/],
      [row({ status: 'COMPLETED' }), { priority: 'HIGH' as const }, /COMPLETED and can no longer change/],
      [row({ status: 'PENDING' }), { progress: 50 }, /only be set while a request is IN_PROGRESS/],
    ])('refuses invalid changes (%#)', async (current, change, message) => {
      await conflict(setup(current).service.update('r1', { version: 1, ...change }, supervisor), message);
    });

    it('rejects an update that changes nothing', async () => {
      await expect(setup().service.update('r1', { version: 1, priority: 'MEDIUM' }, supervisor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('cancel', () => {
    it('lets the submitter cancel an unfinished request', async () => {
      const { service, repo } = setup(row({ status: 'IN_PROGRESS' }));
      await service.cancel('r1', { version: 1, reason: 'not needed' }, operator);
      expect(repo.updateIfVersion.mock.calls[0]![3]).toMatchObject({
        eventType: 'cancelled',
        toStatus: 'CANCELLED',
        message: 'Cancelled by Otto: not needed',
      });
    });

    it("can't cancel a finished request or someone else's", async () => {
      await conflict(setup(row({ status: 'COMPLETED' })).service.cancel('r1', { version: 1 }, operator), /can't be cancelled/);
      await expect(setup().service.cancel('r1', { version: 1 }, otherOperator)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
