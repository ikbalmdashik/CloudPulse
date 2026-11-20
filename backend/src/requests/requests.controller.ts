import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import {
  type ApproveAllDto,
  approveAllSchema,
  type ApproveRequestDto,
  type BulkActionDto,
  bulkActionSchema,
  approveRequestSchema,
  type CancelRequestDto,
  cancelRequestSchema,
  type CreateRequestDto,
  createRequestSchema,
  idempotencyKeySchema,
  type ListRequestsQuery,
  listRequestsQuerySchema,
  type RejectRequestDto,
  rejectRequestSchema,
  type RetryRequestDto,
  retryRequestSchema,
  type UpdateRequestDto,
  updateRequestSchema,
} from './dto/request.schemas.js';
import { RequestsService } from './requests.service.js';

/**
 * HTTP layer for service requests. Every route needs a signed-in user;
 * `@Roles` on the class makes RolesGuard load the user's current role from the
 * database, so access follows promotions and demotions immediately.
 */
@Roles('OPERATOR', 'SUPERVISOR', 'ADMIN')
@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  /**
   * POST /requests — submit a request. Optional `Idempotency-Key` header makes retries safe.
   * 201 created · 200 same key retried · 400 · 401 · 409 key used by someone else
   */
  @Post()
  async create(
    @Body({ schema: createRequestSchema }) dto: CreateRequestDto,
    @Headers('idempotency-key') rawKey: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = idempotencyKeySchema.safeParse(rawKey);
    if (!key.success) throw new BadRequestException(key.error.issues[0]!.message);
    const { request, created } = await this.requests.create(dto, user, key.data);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return request;
  }

  /**
   * GET /requests?status=&category=&priority=&search=&active=&limit=&offset=
   * Operators get their own requests; supervisors and admins get all. 200 `{ items, total, limit, offset }`
   */
  @Get()
  list(@Query({ schema: listRequestsQuerySchema }) query: ListRequestsQuery, @CurrentUser() user: AuthUser) {
    return this.requests.list(query, user);
  }

  /**
   * POST /requests/bulk — `{ action: "approve" | "reject" | "cancel", items: [{ id, version }], reason? }`.
   * Applies the action to each selected request (at most 100) with the same
   * checks as the single action; ones that can't be changed are reported, not
   * fatal. Approve and reject: supervisors and admins. Cancel: anyone, for
   * requests they may cancel. 200 `{ action, succeeded, failed }` · 400 · 403
   */
  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  bulk(@Body({ schema: bulkActionSchema }) dto: BulkActionDto, @CurrentUser() user: AuthUser) {
    return this.requests.bulk(dto, user);
  }

  /**
   * POST /requests/approve-all — approve every request awaiting approval that
   * matches the given list filters (`since`, `category`, `priority`, `search`)
   * and was submitted by `asOf`. Supervisors and admins; their own requests
   * are skipped. Approves at most 200 per call.
   * 200 `{ approved, skippedOwn, skippedChanged, remaining }` · 400 · 403
   */
  @Roles('SUPERVISOR', 'ADMIN')
  @Post('approve-all')
  @HttpCode(HttpStatus.OK)
  approveAll(@Body({ schema: approveAllSchema }) dto: ApproveAllDto, @CurrentUser() user: AuthUser) {
    return this.requests.approveAll(dto, user);
  }

  /** GET /requests/:id — one request with its event timeline. 200 · 404 (missing or not yours) */
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requests.get(id, user);
  }

  /**
   * PATCH /requests/:id — change the priority (moves it in the queue) and/or add a note.
   * Supervisors and admins only. Send the `version` you loaded. Status and
   * progress are driven by the background workers.
   * 200 · 400 · 403 · 404 · 409 finished, or changed by someone else
   */
  @Roles('SUPERVISOR', 'ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body({ schema: updateRequestSchema }) dto: UpdateRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.requests.update(id, dto, user);
  }

  /**
   * POST /requests/:id/approve — approve a request awaiting approval; it is queued for a CPU.
   * Supervisors and admins, but never for a request they submitted themselves.
   * 200 · 403 own request · 404 · 409 not awaiting approval, or changed meanwhile
   */
  @Roles('SUPERVISOR', 'ADMIN')
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id') id: string,
    @Body({ schema: approveRequestSchema }) dto: ApproveRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.requests.approve(id, dto, user);
  }

  /**
   * POST /requests/:id/reject — turn a request down; `reason` is required and shown to the submitter.
   * Supervisors and admins, not for their own requests. 200 · 400 · 403 · 404 · 409
   */
  @Roles('SUPERVISOR', 'ADMIN')
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @Body({ schema: rejectRequestSchema }) dto: RejectRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.requests.reject(id, dto, user);
  }

  /**
   * POST /requests/:id/retry — run a FAILED request again from the start.
   * Supervisors and admins only. 200 · 403 · 404 · 409 not FAILED, or changed meanwhile
   */
  @Roles('SUPERVISOR', 'ADMIN')
  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  retry(
    @Param('id') id: string,
    @Body({ schema: retryRequestSchema }) dto: RetryRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.requests.retry(id, dto, user);
  }

  /**
   * POST /requests/:id/cancel — cancel a request that hasn't finished.
   * The submitter, or any supervisor/admin. 200 · 404 · 409
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id') id: string,
    @Body({ schema: cancelRequestSchema }) dto: CancelRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.requests.cancel(id, dto, user);
  }
}
