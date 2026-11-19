import * as z from 'zod';

/**
 * Body of `POST /users`. Zod implements Standard Schema, so Nest's
 * `StandardSchemaValidationPipe` runs it and answers 400 with every issue.
 * Strict: unknown fields (including `role`) are rejected — new users are always
 * OPERATORs, and only an admin can change a role via `PATCH /users/:id/role`.
 */
export const createUserSchema = z.strictObject({
  email: z
    .string({ error: 'is required and must be a string' })
    .trim()
    .toLowerCase()
    .max(254, { error: 'must be at most 254 characters' })
    .pipe(z.email({ error: 'must be a valid email address' })),
  fullName: z
    .string({ error: 'is required and must be a string' })
    .trim()
    .min(2, { error: 'must be 2-100 characters' })
    .max(100, { error: 'must be 2-100 characters' }),
  password: z
    .string({ error: 'is required and must be a string' })
    .min(8, { error: 'must be 8-128 characters' })
    .max(128, { error: 'must be 8-128 characters' })
    .regex(/[A-Za-z]/, { error: 'must contain at least one letter' })
    .regex(/\d/, { error: 'must contain at least one digit' }),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
