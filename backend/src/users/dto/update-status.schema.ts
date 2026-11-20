import * as z from 'zod';

/** Body of `PATCH /users/:id/status`: `false` deactivates the account, `true` reactivates it. */
export const updateStatusSchema = z.strictObject({
  active: z.boolean({ error: 'is required: true or false' }),
});

export type UpdateStatusDto = z.infer<typeof updateStatusSchema>;
