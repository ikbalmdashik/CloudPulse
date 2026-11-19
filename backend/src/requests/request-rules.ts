/** Service request vocabulary and lifecycle rules, shared by validation and business logic. */

export const CATEGORIES = [
  'VM_PROVISIONING',
  'HEALTH_DIAGNOSTIC',
  'CONFIG_UPDATE',
  'AUDIT_REPORT',
  'ACCESS_RESET',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type Status = (typeof STATUSES)[number];

export const ENVIRONMENTS = ['development', 'staging', 'production'] as const;

/**
 * Allowed status changes. A request starts PENDING, is picked up (IN_PROGRESS)
 * and ends COMPLETED, FAILED or CANCELLED. Final states never change again,
 * so a finished request's history can be trusted.
 */
export const TRANSITIONS: Record<Status, readonly Status[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isFinal(status: Status): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}
