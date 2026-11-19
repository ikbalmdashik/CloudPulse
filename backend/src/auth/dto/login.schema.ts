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
  /**
   * Keep this device signed in for REMEMBER_ME_DAYS, across browser restarts.
   * Without it the session lasts SESSION_TTL_HOURS and its cookies are
   * deleted when the browser closes.
   */
  rememberMe: z.boolean({ error: 'must be true or false' }).default(false),
});

export type LoginDto = z.infer<typeof loginSchema>;
