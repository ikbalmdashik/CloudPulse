import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../auth/auth-user.js';
import type { Env } from '../config/env.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { STAFF_ROLES } from '../realtime/realtime.gateway.js';
import type {
  ApproveAllDto,
  BulkActionDto,
  ApproveRequestDto,
  CancelRequestDto,
  CreateRequestDto,
  ListRequestsQuery,
  RejectRequestDto,
  RetryRequestDto,
  UpdateRequestDto,
} from './dto/request.schemas.js';
import { QueueSignal } from './queue-signal.js';
import { canTransition, isFinal } from './request-rules.js';
import {
  DuplicateIdempotencyKeyError,
  type NewEvent,
  type RequestChanges,
  type RequestRow,
  RequestsRepository,
} from './requests.repository.js';

const isStaff = (user: AuthUser) => STAFF_ROLES.includes(user.role);

/** Most requests one "approve all" click approves; the rest wait for another click. */
export const APPROVE_ALL_LIMIT = 200;

/** What `POST /requests/bulk` did. */
export interface BulkActionResult {
  action: BulkActionDto['action'];
  /** Ids of the requests the action was applied to. */
  succeeded: string[];
  /** Requests left unchanged, with the reason (the same error the single action gives). */
  failed: { id: string; status: number; message: string }[];
}

/** What `POST /requests/approve-all` did. */
export interface ApproveAllResult {
  /** Requests approved and queued. */
  approved: number;
  /** Matching requests the user submitted themselves (four-eyes rule): left for someone else. */
  skippedOwn: number;
  /** Requests that changed meanwhile (e.g. someone else approved or cancelled them first). */
  skippedChanged: number;
  /** Matching requests beyond APPROVE_ALL_LIMIT, still awaiting approval. */
  remaining: number;
}
const STALE =
  'This request was changed since you loaded it. Reload to see the latest version, then try again.';

/**
 * Business rules for service requests. Knows nothing about HTTP or SQL.
 *
 * Lifecycle: a submitted request waits AWAITING_APPROVAL until a supervisor
 * or admin who did not submit it approves it (→ PENDING, queued) or rejects
 * it (→ REJECTED). The background CPUs then move it IN_PROGRESS → COMPLETED
 * (or FAILED after its retries). People also steer it through priority,
 * notes, cancel and retry.
 */
@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);
  private readonly maxAttempts: number;

  constructor(
    private readonly requests: RequestsRepository,
    private readonly realtime: RealtimeService,
    private readonly queue: QueueSignal,
    config: ConfigService<Env, true>,
  ) {
    this.maxAttempts = config.get('WORKER_MAX_ATTEMPTS', { infer: true });
  }

  /**
   * Submits a request; it waits for approval. With an `Idempotency-Key`,
   * retrying the same submission (e.g. after a network error) returns the
   * first request instead of a duplicate.
   */
  async create(
    dto: CreateRequestDto,
    user: AuthUser,
    idempotencyKey?: string,
  ): Promise<{ request: RequestRow; created: boolean }> {
    let id: string;
    try {
      id = await this.requests.create(
        {
          title: dto.title,
          description: dto.description || null,
          category: dto.category,
          priority: dto.priority,
          payload: dto.payload ?? null,
          operatorId: user.id,
          idempotencyKey: idempotencyKey ?? null,
        },
        { actorId: user.id, message: `Submitted by ${user.fullName}; awaiting approval` },
      );
    } catch (err) {
      if (!(err instanceof DuplicateIdempotencyKeyError)) throw err;
      const existing = await this.requests.findByIdempotencyKey(err.key);
      if (!existing || existing.operatorId !== user.id) {
        throw new ConflictException('This Idempotency-Key was already used');
      }
      return { request: (await this.requests.findById(existing.id))!, created: false };
    }

    const request = (await this.requests.findById(id))!;
    const [event] = await this.requests.findEvents(id);
    this.realtime.requestChanged(request.operatorId, { request, event });
    this.logger.log(`Request ${request.code} created by ${user.id}; awaiting approval`);
    return { request, created: true };
  }

  /** Supervisors and admins see every request; operators see their own. */
  list(query: ListRequestsQuery, user: AuthUser) {
    return this.requests.list(query, isStaff(user) ? undefined : user.id);
  }

  async get(id: string, user: AuthUser) {
    const request = await this.findVisible(id, user);
    const events = await this.requests.findEvents(id);
    return { ...request, events };
  }

  /** Supervisor/admin edits: priority (moves it in the queue) and/or a timeline note. */
  async update(id: string, dto: UpdateRequestDto, user: AuthUser): Promise<RequestRow> {
    const current = await this.findVisible(id, user);
    if (current.version !== dto.version) throw new ConflictException(STALE);

    const changes: RequestChanges = {};
    const parts: string[] = [];
    if (dto.priority !== undefined && dto.priority !== current.priority) {
      if (isFinal(current.status)) {
        throw new ConflictException(`This request is ${current.status}; its priority can no longer change`);
      }
      changes.priority = dto.priority;
      parts.push(`Priority changed from ${current.priority} to ${dto.priority}`);
    }
    const note = dto.note?.trim();
    if (!changes.priority && !note) {
      throw new BadRequestException('Nothing to change: the request already has this priority');
    }
    if (note) parts.push(`Note: ${note}`);

    return this.apply(current, dto.version, changes, {
      actorId: user.id,
      eventType: changes.priority ? 'updated' : 'note',
      message: parts.join(' · '),
    });
  }

  /**
   * The submitter (or any supervisor/admin) cancels a request that hasn't
   * finished. A queued job is cancelled with it; a running job stops at its
   * next step.
   */
  async cancel(id: string, dto: CancelRequestDto, user: AuthUser): Promise<RequestRow> {
    const current = await this.findVisible(id, user);
    if (current.version !== dto.version) throw new ConflictException(STALE);
    if (!canTransition(current.status, 'CANCELLED')) {
      throw new ConflictException(`This request is ${current.status} and can't be cancelled`);
    }
    const reason = dto.reason?.trim();
    return this.apply(
      current,
      dto.version,
      { status: 'CANCELLED', completedAt: new Date(), currentStep: null },
      {
        actorId: user.id,
        eventType: 'cancelled',
        fromStatus: current.status,
        toStatus: 'CANCELLED',
        message: `Cancelled by ${user.fullName}${reason ? `: ${reason}` : ''}`,
      },
      { cancelQueued: true },
    );
  }

  /**
   * Supervisor/admin approves a request, which queues it for a CPU.
   * Four-eyes rule: nobody can approve a request they submitted themselves.
   */
  async approve(id: string, dto: ApproveRequestDto, user: AuthUser): Promise<RequestRow> {
    const current = await this.findVisible(id, user);
    if (current.operatorId === user.id) {
      throw new ForbiddenException("You can't approve your own request; another supervisor or admin must approve it");
    }
    if (current.version !== dto.version) throw new ConflictException(STALE);
    if (current.status !== 'AWAITING_APPROVAL') {
      throw new ConflictException(`This request is ${current.status}; only requests awaiting approval can be approved`);
    }
    const now = new Date();
    const request = await this.apply(
      current,
      dto.version,
      { status: 'PENDING', approvedById: user.id, approvedAt: now },
      {
        actorId: user.id,
        eventType: 'approved',
        fromStatus: 'AWAITING_APPROVAL',
        toStatus: 'PENDING',
        message: `Approved by ${user.fullName}; queued for processing`,
      },
      { enqueue: { maxAttempts: this.maxAttempts } },
    );
    this.queue.notify(); // wake an idle CPU now rather than at its next poll
    return request;
  }

  /**
   * Supervisor/admin approves every request awaiting approval that matches
   * the list filters (time window, category, priority, search) and was
   * submitted no later than `asOf`. Each is approved like a single approval:
   * same four-eyes rule (their own requests are skipped), same optimistic
   * locking (one changed meanwhile is skipped, not overwritten).
   */
  async approveAll(dto: ApproveAllDto, user: AuthUser): Promise<ApproveAllResult> {
    const filter = { category: dto.category, priority: dto.priority, search: dto.search, since: dto.since, asOf: dto.asOf };
    const [{ items, total }, all] = await Promise.all([
      this.requests.findAwaitingApproval(filter, user.id, APPROVE_ALL_LIMIT),
      this.requests.countAwaitingApproval(filter),
    ]);

    const now = new Date();
    let approved = 0;
    for (const r of items) {
      const eventId = await this.requests.updateIfVersion(
        r.id,
        r.version,
        { status: 'PENDING', approvedById: user.id, approvedAt: now },
        {
          actorId: user.id,
          eventType: 'approved',
          fromStatus: 'AWAITING_APPROVAL',
          toStatus: 'PENDING',
          message: `Approved by ${user.fullName} (bulk approval); queued for processing`,
        },
        { enqueue: { maxAttempts: this.maxAttempts } },
      );
      if (!eventId) continue;
      approved++;
      await this.publish(r.id, eventId);
    }
    if (approved > 0) this.queue.notify();

    const result: ApproveAllResult = {
      approved,
      skippedOwn: all - total,
      skippedChanged: items.length - approved,
      remaining: total - items.length,
    };
    this.logger.log(`Bulk approval by ${user.id}: ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * Applies one action to the requests the user selected. Each request goes
   * through exactly the same checks as the single-request action (visibility,
   * four-eyes rule, version, allowed status change), one at a time, so one
   * that can't be changed is reported and the rest still go through.
   * Approving and rejecting are for supervisors and admins; anyone can cancel
   * (their own requests, or any request if they are staff).
   */
  async bulk(dto: BulkActionDto, user: AuthUser): Promise<BulkActionResult> {
    if (dto.action !== 'cancel' && !isStaff(user)) {
      throw new ForbiddenException('Only supervisors and admins can approve or reject requests');
    }
    const succeeded: string[] = [];
    const failed: BulkActionResult['failed'] = [];
    for (const { id, version } of dto.items) {
      try {
        if (dto.action === 'approve') await this.approve(id, { version }, user);
        else if (dto.action === 'reject') await this.reject(id, { version, reason: dto.reason! }, user);
        else await this.cancel(id, { version, reason: dto.reason }, user);
        succeeded.push(id);
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        failed.push({ id, status: err.getStatus(), message: err.message });
      }
    }
    this.logger.log(`Bulk ${dto.action} by ${user.id}: ${succeeded.length} done, ${failed.length} skipped`);
    return { action: dto.action, succeeded, failed };
  }

  /** Supervisor/admin turns a request down, with a reason the submitter sees. Same four-eyes rule. */
  async reject(id: string, dto: RejectRequestDto, user: AuthUser): Promise<RequestRow> {
    const current = await this.findVisible(id, user);
    if (current.operatorId === user.id) {
      throw new ForbiddenException("You can't reject your own request; cancel it instead");
    }
    if (current.version !== dto.version) throw new ConflictException(STALE);
    if (current.status !== 'AWAITING_APPROVAL') {
      throw new ConflictException(`This request is ${current.status}; only requests awaiting approval can be rejected`);
    }
    return this.apply(
      current,
      dto.version,
      { status: 'REJECTED', completedAt: new Date(), errorReason: dto.reason },
      {
        actorId: user.id,
        eventType: 'rejected',
        fromStatus: 'AWAITING_APPROVAL',
        toStatus: 'REJECTED',
        message: `Rejected by ${user.fullName}: ${dto.reason}`,
        metadata: { reason: dto.reason },
      },
    );
  }

  /** Supervisor/admin: run a FAILED request again from the start, with a fresh set of attempts. */
  async retry(id: string, dto: RetryRequestDto, user: AuthUser): Promise<RequestRow> {
    const current = await this.findVisible(id, user);
    if (current.version !== dto.version) throw new ConflictException(STALE);
    if (current.status !== 'FAILED') {
      throw new ConflictException(`Only FAILED requests can be retried; this one is ${current.status}`);
    }
    const request = await this.apply(
      current,
      dto.version,
      { status: 'PENDING', progress: 0, currentStep: null, errorReason: null, result: null, startedAt: null, completedAt: null },
      {
        actorId: user.id,
        eventType: 'retried',
        fromStatus: 'FAILED',
        toStatus: 'PENDING',
        message: `Retried by ${user.fullName}; queued for processing`,
      },
      { enqueue: { maxAttempts: this.maxAttempts } },
    );
    this.queue.notify();
    return request;
  }

  /** Loads a request and one of its events and pushes them to everyone who may see it. */
  async publish(requestId: string, eventId: string): Promise<RequestRow | null> {
    const [request, event] = await Promise.all([
      this.requests.findById(requestId),
      this.requests.findEvent(eventId),
    ]);
    if (request) this.realtime.requestChanged(request.operatorId, { request, event });
    return request;
  }

  /** Writes the change (if the version still matches), then pushes it live. */
  private async apply(
    current: RequestRow,
    version: number,
    changes: RequestChanges,
    event: NewEvent,
    jobs?: Parameters<RequestsRepository['updateIfVersion']>[4],
  ) {
    const eventId = await this.requests.updateIfVersion(current.id, version, changes, event, jobs);
    if (!eventId) throw new ConflictException(STALE);
    return (await this.publish(current.id, eventId))!;
  }

  /** The request, if this user may see it. Others get 404, so ids can't be probed. */
  private async findVisible(id: string, user: AuthUser): Promise<RequestRow> {
    const request = await this.requests.findById(id);
    if (!request || (!isStaff(user) && request.operatorId !== user.id)) {
      throw new NotFoundException('Request not found');
    }
    return request;
  }
}
