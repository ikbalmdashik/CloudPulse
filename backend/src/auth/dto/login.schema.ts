import * as z from 'zod';

/**
 * Body of `POST /auth/login`. Only presence and length are checked: strength
 * rules belong to sign-up, and a precise error here would help guessing.
 */
export const loginSchema = z.strictObject({
  email: z
    .string({ error: 'is required and must be a string' })
    .trim()
    .toLowerCase()
    .min(1, { error: 'is required' })
    .max(254, { error: 'must be at most 254 characters' }),
  password: z
    .string({ error: 'is required and must be a string' })
    .min(1, { error: 'is required' })
    .max(128, { error: 'must be at most 128 characters' }),
});

export type LoginDto = z.infer<typeof loginSchema>;
