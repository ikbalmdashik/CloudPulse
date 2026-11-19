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

export const STATUSES = [
  'AWAITING_APPROVAL',
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'REJECTED',
] as const;
export type Status = (typeof STATUSES)[number];

export const ENVIRONMENTS = ['development', 'staging', 'production'] as const;

/** Statuses that still need work: shown by the "active" filter. */
export const ACTIVE_STATUSES: readonly Status[] = ['AWAITING_APPROVAL', 'PENDING', 'IN_PROGRESS'];

/**
 * Allowed status changes. A request starts AWAITING_APPROVAL; a supervisor or
 * admin who didn't submit it approves it (→ PENDING, queued for a CPU) or
 * rejects it. A CPU picks it up (IN_PROGRESS) and it ends COMPLETED or
 * FAILED; it can be CANCELLED any time before that. Final states never change
 * again (except a FAILED request being retried), so a finished request's
 * history can be trusted.
 */
export const TRANSITIONS: Record<Status, readonly Status[]> = {
  AWAITING_APPROVAL: ['PENDING', 'REJECTED', 'CANCELLED'],
  PENDING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  REJECTED: [],
};

export function isFinal(status: Status): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}
