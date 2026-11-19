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
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const ENVIRONMENT_LABEL: Record<Environment, string> = {
  development: "Development",
  staging: "Staging",
  production: "Production",
};
