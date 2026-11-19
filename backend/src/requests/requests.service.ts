import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { STAFF_ROLES } from '../realtime/realtime.gateway.js';
import type {
  CancelRequestDto,
  CreateRequestDto,
  ListRequestsQuery,
  UpdateRequestDto,
} from './dto/request.schemas.js';
import { canTransition, isFinal } from './request-rules.js';
import {
  DuplicateIdempotencyKeyError,
  type NewEvent,
  type RequestChanges,
  type RequestRow,
  RequestsRepository,
} from './requests.repository.js';

const isStaff = (user: AuthUser) => STAFF_ROLES.includes(user.role);
const STALE =
  'This request was changed by someone else since you loaded it. Reload to see the latest version, then try again.';

/** Business rules for service requests. Knows nothing about HTTP or SQL. */
@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private readonly requests: RequestsRepository,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Submits a request. With an `Idempotency-Key`, retrying the same submission
   * (e.g. after a network error) returns the first request instead of a duplicate.
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
        { actorId: user.id, message: `Submitted by ${user.fullName}` },
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
    this.logger.log(`Request ${request.code} created by ${user.id}`);
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

  /** Supervisor/admin changes: status, progress, current step, priority, or a note. */
  async update(id: string, dto: UpdateRequestDto, user: AuthUser): Promise<RequestRow> {
    const current = await this.findVisible(id, user);
    if (current.version !== dto.version) throw new ConflictException(STALE);
    if (isFinal(current.status)) {
      throw new ConflictException(`This request is ${current.status} and can no longer change`);
    }

    const now = new Date();
    const changes: RequestChanges = {};
    const parts: string[] = [];
    let nextStatus = current.status;

    if (dto.status !== undefined && dto.status !== current.status) {
      if (!canTransition(current.status, dto.status)) {
        throw new ConflictException(`Can't change status from ${current.status} to ${dto.status}`);
      }
      nextStatus = dto.status;
      changes.status = dto.status;
      parts.push(`Status changed from ${current.status} to ${dto.status}`);
      if (dto.status === 'IN_PROGRESS' && !current.startedAt) changes.startedAt = now;
      if (dto.status === 'COMPLETED') {
        changes.progress = 100;
        changes.currentStep = null;
      }
      if (dto.status === 'FAILED') changes.errorReason = dto.errorReason!;
      if (isFinal(dto.status)) changes.completedAt = now;
    }

    if (dto.progress !== undefined || dto.currentStep !== undefined) {
      if (nextStatus !== 'IN_PROGRESS') {
        throw new ConflictException('Progress and current step can only be set while a request is IN_PROGRESS');
      }
      if (dto.progress !== undefined && dto.progress !== current.progress) {
        changes.progress = dto.progress;
        parts.push(`Progress ${dto.progress}%`);
      }
      if (dto.currentStep !== undefined && (dto.currentStep || null) !== current.currentStep) {
        changes.currentStep = dto.currentStep || null;
        if (changes.currentStep) parts.push(`Step: ${changes.currentStep}`);
      }
    }

    if (dto.priority !== undefined && dto.priority !== current.priority) {
      changes.priority = dto.priority;
      parts.push(`Priority changed from ${current.priority} to ${dto.priority}`);
    }

    const note = dto.note?.trim();
    if (Object.keys(changes).length === 0 && !note) {
      throw new BadRequestException('Nothing to change: the request already has these values');
    }
    if (note) parts.push(`Note: ${note}`);

    const event: NewEvent = {
      actorId: user.id,
      eventType: changes.status
        ? 'status_changed'
        : changes.progress !== undefined || changes.currentStep !== undefined
          ? 'progress_updated'
          : changes.priority
            ? 'updated'
            : 'note',
      fromStatus: changes.status ? current.status : null,
      toStatus: changes.status ?? null,
      progress: changes.progress ?? null,
      message: parts.join(' · '),
      metadata: dto.errorReason ? { errorReason: dto.errorReason } : null,
    };
    return this.apply(current, dto.version, changes, event);
  }

  /** The submitter (or any supervisor/admin) cancels a request that hasn't finished. */
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
      { status: 'CANCELLED', completedAt: new Date() },
      {
        actorId: user.id,
        eventType: 'cancelled',
        fromStatus: current.status,
        toStatus: 'CANCELLED',
        message: `Cancelled by ${user.fullName}${reason ? `: ${reason}` : ''}`,
      },
    );
  }

  /** Writes the change (if the version still matches), then pushes it live. */
  private async apply(current: RequestRow, version: number, changes: RequestChanges, event: NewEvent) {
    const eventId = await this.requests.updateIfVersion(current.id, version, changes, event);
    if (!eventId) throw new ConflictException(STALE);

    const [request, savedEvent] = await Promise.all([
      this.requests.findById(current.id),
      this.requests.findEvent(eventId),
    ]);
    this.realtime.requestChanged(request!.operatorId, { request, event: savedEvent });
    return request!;
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
