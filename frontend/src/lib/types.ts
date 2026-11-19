export const ROLES = ["OPERATOR", "SUPERVISOR", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** The signed-in user, from `GET /auth/me`. */
export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

/** A user as the API returns it (never includes the password hash). */
export interface User extends SessionUser {
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const STAFF_ROLES: readonly Role[] = ["SUPERVISOR", "ADMIN"];
export const isStaff = (role: Role | undefined) => !!role && STAFF_ROLES.includes(role);

export const CATEGORIES = [
  "VM_PROVISIONING",
  "HEALTH_DIAGNOSTIC",
  "CONFIG_UPDATE",
  "AUDIT_REPORT",
  "ACCESS_RESET",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUSES = [
  "AWAITING_APPROVAL",
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
] as const;
export type Status = (typeof STATUSES)[number];

export const ENVIRONMENTS = ["development", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Mirrors backend/src/requests/request-rules.ts. */
export const TRANSITIONS: Record<Status, readonly Status[]> = {
  AWAITING_APPROVAL: ["PENDING", "REJECTED", "CANCELLED"],
  PENDING: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  REJECTED: [],
};
export const isFinal = (s: Status) => TRANSITIONS[s].length === 0;

/** The latest background job for a request: which worker, which attempt. */
export interface JobSummary {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  attempt: number;
  maxAttempts: number;
  workerId: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ServiceRequest {
  id: string;
  code: string;
  title: string;
  description: string | null;
  category: Category;
  priority: Priority;
  status: Status;
  progress: number;
  currentStep: string | null;
  payload: { environment?: Environment; target?: string } | null;
  errorReason: string | null;
  /** What the worker produced, e.g. the new VM's id and IP. */
  result: Record<string, string | number | boolean | null> | null;
  version: number;
  operatorId: string;
  operator: { id: string; fullName: string; email: string } | null;
  /** The supervisor or admin who approved it (never the submitter). */
  approvedById: string | null;
  approvedAt: string | null;
  approvedBy?: { id: string; fullName: string } | null;
  /** Latest processing job first (the detail endpoint includes it). */
  jobs?: JobSummary[];
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RequestEvent {
  id: string;
  eventType:
    | "created"
    | "status_changed"
    | "progress_updated"
    | "updated"
    | "note"
    | "cancelled"
    | "retried"
    | "processing"
    | "approved"
    | "rejected";
  fromStatus: Status | null;
  toStatus: Status | null;
  progress: number | null;
  message: string;
  createdAt: string;
  /** Null for the background worker. */
  actor: { id: string; fullName: string; role: Role } | null;
}

export interface RequestDetail extends ServiceRequest {
  events: RequestEvent[];
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
