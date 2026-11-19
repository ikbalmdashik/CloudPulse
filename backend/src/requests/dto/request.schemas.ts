import * as z from 'zod';
import { CATEGORIES, ENVIRONMENTS, PRIORITIES, STATUSES } from '../request-rules.js';

const version = z.number({ error: 'is required: the version you last saw' }).int().min(1);

/** Body of `POST /requests`. */
export const createRequestSchema = z.strictObject({
  title: z
    .string({ error: 'is required' })
    .trim()
    .min(3, { error: 'must be 3-120 characters' })
    .max(120, { error: 'must be 3-120 characters' }),
  description: z.string().trim().max(2000, { error: 'must be at most 2000 characters' }).optional(),
  category: z.enum(CATEGORIES, { error: `must be one of ${CATEGORIES.join(', ')}` }),
  priority: z.enum(PRIORITIES, { error: `must be one of ${PRIORITIES.join(', ')}` }).default('MEDIUM'),
  /** What the request is about: which environment, and which host/service/account. */
  payload: z
    .strictObject({
      environment: z.enum(ENVIRONMENTS, { error: `must be one of ${ENVIRONMENTS.join(', ')}` }),
      target: z
        .string({ error: 'is required' })
        .trim()
        .min(1, { error: 'is required' })
        .max(200, { error: 'must be at most 200 characters' }),
    })
    .optional(),
});
export type CreateRequestDto = z.infer<typeof createRequestSchema>;

/**
 * "Submitted within the last …" windows for the list's time filter, in
 * milliseconds. Short windows suit a live approval queue; long ones, review.
 */
export const SINCE_WINDOWS = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 3_600_000,
  '6h': 6 * 3_600_000,
  '24h': 24 * 3_600_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
} as const;
export type SinceWindow = keyof typeof SINCE_WINDOWS;
const SINCE_KEYS = Object.keys(SINCE_WINDOWS) as [SinceWindow, ...SinceWindow[]];

const since = z.enum(SINCE_KEYS, { error: `must be one of ${SINCE_KEYS.join(', ')}` }).optional();
/**
 * The moment the time window is measured back from (ISO 8601); defaults to now.
 * Also an upper bound: requests submitted after it are left out, so "approve
 * all" only touches what the user was looking at.
 */
const asOf = z.iso.datetime({ offset: true, error: 'must be an ISO 8601 date-time' }).transform((v) => new Date(v));

const category = z.enum(CATEGORIES, { error: `must be one of ${CATEGORIES.join(', ')}` }).optional();
const priority = z.enum(PRIORITIES, { error: `must be one of ${PRIORITIES.join(', ')}` }).optional();
const search = z.string().trim().max(100, { error: 'must be at most 100 characters' }).optional();

/** Query of `GET /requests`. Operators only ever see their own requests. */
export const listRequestsQuerySchema = z.strictObject({
  status: z.enum(STATUSES, { error: `must be one of ${STATUSES.join(', ')}` }).optional(),
  category,
  priority,
  /** Case-insensitive match on code or title. */
  search,
  /** Only requests submitted within this window. */
  since,
  asOf: asOf.optional(),
  /** Only requests that still need work (PENDING or IN_PROGRESS). */
  active: z
    .enum(['true', 'false'], { error: 'must be true or false' })
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number({ error: 'must be a number' }).int().min(1, { error: 'must be 1-100' }).max(100, { error: 'must be 1-100' }).default(20),
  offset: z.coerce.number({ error: 'must be a number' }).int().min(0, { error: 'must be 0 or more' }).default(0),
});
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

/**
 * Body of `PATCH /requests/:id` (supervisors and admins): change the priority
 * (which moves the request in the processing queue) and/or add a timeline
 * note. Status and progress are driven by the background workers; staff use
 * cancel and retry to intervene. `version` is the request version the client
 * last saw: if it changed since, the edit is refused (409) instead of
 * silently overwriting someone else's.
 */
export const updateRequestSchema = z
  .strictObject({
    version,
    priority: z.enum(PRIORITIES, { error: `must be one of ${PRIORITIES.join(', ')}` }).optional(),
    /** A note recorded in the request's timeline. */
    note: z.string().trim().max(500, { error: 'must be at most 500 characters' }).optional(),
  })
  .refine((v) => v.priority !== undefined || (v.note !== undefined && v.note !== ''), {
    error: 'nothing to change: send priority or note',
  });
export type UpdateRequestDto = z.infer<typeof updateRequestSchema>;

/** Body of `POST /requests/:id/approve` (a supervisor or admin who didn't submit it). */
export const approveRequestSchema = z.strictObject({ version });
export type ApproveRequestDto = z.infer<typeof approveRequestSchema>;

/**
 * Body of `POST /requests/approve-all`: the list filters the user is looking
 * at. Every request matching them that is awaiting approval (and that the user
 * didn't submit) is approved. `asOf` is required so a request that arrives
 * while the user is deciding is never approved unseen.
 */
export const approveAllSchema = z.strictObject({ category, priority, search, since, asOf });
export type ApproveAllDto = z.infer<typeof approveAllSchema>;

/** Body of `POST /requests/:id/reject`: the reason is shown to the submitter. */
export const rejectRequestSchema = z.strictObject({
  version,
  reason: z
    .string({ error: 'is required: tell the submitter why' })
    .trim()
    .min(3, { error: 'is required: tell the submitter why (at least 3 characters)' })
    .max(500, { error: 'must be at most 500 characters' }),
});
export type RejectRequestDto = z.infer<typeof rejectRequestSchema>;

/** Body of `POST /requests/:id/retry` (supervisors and admins). */
export const retryRequestSchema = z.strictObject({ version });
export type RetryRequestDto = z.infer<typeof retryRequestSchema>;

/** Body of `POST /requests/:id/cancel`. */
export const cancelRequestSchema = z.strictObject({
  version,
  reason: z.string().trim().max(500, { error: 'must be at most 500 characters' }).optional(),
});
export type CancelRequestDto = z.infer<typeof cancelRequestSchema>;

/** `Idempotency-Key` header: lets a client retry a create without making a duplicate. */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, { error: 'Idempotency-Key must be 8-100 characters' })
  .max(100, { error: 'Idempotency-Key must be 8-100 characters' })
  .optional();
