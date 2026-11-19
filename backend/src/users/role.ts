export const ROLES = ['OPERATOR', 'SUPERVISOR', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];
