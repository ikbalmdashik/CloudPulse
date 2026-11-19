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

/** Query of `GET /requests`. Operators only ever see their own requests. */
export const listRequestsQuerySchema = z.strictObject({
  status: z.enum(STATUSES, { error: `must be one of ${STATUSES.join(', ')}` }).optional(),
  category: z.enum(CATEGORIES, { error: `must be one of ${CATEGORIES.join(', ')}` }).optional(),
  priority: z.enum(PRIORITIES, { error: `must be one of ${PRIORITIES.join(', ')}` }).optional(),
  /** Case-insensitive match on code or title. */
  search: z.string().trim().max(100, { error: 'must be at most 100 characters' }).optional(),
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
 * Body of `PATCH /requests/:id` (supervisors and admins). `version` is the
 * request version the client last saw: if someone else changed the request
 * since, the update is refused (409) instead of silently overwriting theirs.
 */
export const updateRequestSchema = z
  .strictObject({
    version,
    status: z.enum(STATUSES, { error: `must be one of ${STATUSES.join(', ')}` }).optional(),
    progress: z
      .number({ error: 'must be a number' })
      .int({ error: 'must be a whole number' })
      .min(0, { error: 'must be 0-100' })
      .max(100, { error: 'must be 0-100' })
      .optional(),
    currentStep: z.string().trim().max(200, { error: 'must be at most 200 characters' }).nullable().optional(),
    priority: z.enum(PRIORITIES, { error: `must be one of ${PRIORITIES.join(', ')}` }).optional(),
    /** Why the request failed; required when setting status FAILED. */
    errorReason: z.string().trim().min(1).max(500, { error: 'must be at most 500 characters' }).optional(),
    /** A note recorded in the request's timeline. */
    note: z.string().trim().max(500, { error: 'must be at most 500 characters' }).optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.progress !== undefined ||
      v.currentStep !== undefined ||
      v.priority !== undefined ||
      (v.note !== undefined && v.note !== ''),
    { error: 'nothing to change: send status, progress, currentStep, priority or note' },
  )
  .refine((v) => v.status !== 'FAILED' || v.errorReason, {
    path: ['errorReason'],
    error: 'is required when marking a request as FAILED',
  });
export type UpdateRequestDto = z.infer<typeof updateRequestSchema>;

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
