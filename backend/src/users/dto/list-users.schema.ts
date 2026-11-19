import * as z from 'zod';
import { ROLES } from '../role.js';

/** Query string of `GET /users`, e.g. `?role=OPERATOR&search=ali&limit=20`. */
export const listUsersQuerySchema = z.strictObject({
  role: z.enum(ROLES, { error: `must be one of ${ROLES.join(', ')}` }).optional(),
  /** Case-insensitive match on email or full name. */
  search: z.string().trim().max(100, { error: 'must be at most 100 characters' }).optional(),
  limit: z.coerce
    .number({ error: 'must be a number' })
    .int({ error: 'must be an integer' })
    .min(1, { error: 'must be 1-100' })
    .max(100, { error: 'must be 1-100' })
    .default(50),
  offset: z.coerce
    .number({ error: 'must be a number' })
    .int({ error: 'must be an integer' })
    .min(0, { error: 'must be 0 or more' })
    .default(0),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
