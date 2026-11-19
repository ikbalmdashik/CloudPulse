import type { Category, Environment, Priority, Status } from "./types";

export const CATEGORY_LABEL: Record<Category, string> = {
  VM_PROVISIONING: "VM provisioning",
  HEALTH_DIAGNOSTIC: "Health diagnostic",
  CONFIG_UPDATE: "Config update",
  AUDIT_REPORT: "Audit report",
  ACCESS_RESET: "Access reset",
};

export const CATEGORY_HINT: Record<Category, string> = {
  VM_PROVISIONING: "Create a new virtual machine",
  HEALTH_DIAGNOSTIC: "Check the health of a host or service",
  CONFIG_UPDATE: "Change configuration on a host or service",
  AUDIT_REPORT: "Produce a compliance or usage report",
  ACCESS_RESET: "Reset credentials or access for an account",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const STATUS_LABEL: Record<Status, string> = {
  AWAITING_APPROVAL: "Awaiting approval",
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
};

export const ENVIRONMENT_LABEL: Record<Environment, string> = {
  development: "Development",
  staging: "Staging",
  production: "Production",
};

/** "Submitted within" windows for the requests list (keys match the API's `since`). */
export const SINCE_OPTIONS = [
  { value: "1m", label: "Last 1 minute" },
  { value: "5m", label: "Last 5 minutes" },
  { value: "15m", label: "Last 15 minutes" },
  { value: "30m", label: "Last 30 minutes" },
  { value: "1h", label: "Last hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
] as const;
export type SinceWindow = (typeof SINCE_OPTIONS)[number]["value"];
export const SINCE_VALUES = SINCE_OPTIONS.map((o) => o.value) as readonly SinceWindow[];
export const SINCE_LABEL = Object.fromEntries(SINCE_OPTIONS.map((o) => [o.value, o.label])) as Record<SinceWindow, string>;
