import * as z from 'zod';

/**
 * Body of `POST /auth/refresh`. Browsers send nothing (the refresh token is in
 * the `cp_refresh` cookie); API clients send the token they got from login.
 */
export const refreshSchema = z
  .strictObject({
    refreshToken: z.string().min(1, { error: 'must not be empty' }).max(200, { error: 'is too long' }).optional(),
  })
  .default({});

export type RefreshDto = z.infer<typeof refreshSchema>;
