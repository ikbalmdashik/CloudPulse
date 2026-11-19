import * as z from 'zod';
import type { Role } from '../role.js';

/**
 * Role changes an admin can make through the API, as target → required
 * current role. ADMIN is never granted or removed here (only by the seed command).
 */
export const ROLE_TRANSITIONS = {
  SUPERVISOR: 'OPERATOR', // promote
  OPERATOR: 'SUPERVISOR', // demote
} as const satisfies Partial<Record<Role, Role>>;

export type AssignableRole = keyof typeof ROLE_TRANSITIONS;
const ASSIGNABLE = Object.keys(ROLE_TRANSITIONS) as [AssignableRole, ...AssignableRole[]];

/** Body of `PATCH /users/:id/role`. */
export const updateRoleSchema = z.strictObject({
  role: z.enum(ASSIGNABLE, { error: `must be one of ${ASSIGNABLE.join(', ')}` }),
});

export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;
