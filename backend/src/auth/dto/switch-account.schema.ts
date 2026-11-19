import * as z from 'zod';
import { isUserId } from '../session-cookie.js';

/** Body of `POST /auth/switch`: which saved account to make active. */
export const switchAccountSchema = z.strictObject({
  userId: z.string({ error: 'is required' }).refine(isUserId, { error: 'must be a user id' }),
});
export type SwitchAccountDto = z.infer<typeof switchAccountSchema>;
