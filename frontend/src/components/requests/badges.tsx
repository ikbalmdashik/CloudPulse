import { Badge } from "@/components/ui/badge";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/labels";
import type { Priority, Status } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<Status, string> = {
  PENDING: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  IN_PROGRESS: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  COMPLETED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  FAILED: "border-destructive/40 bg-destructive/10 text-destructive",
  CANCELLED: "border-border bg-muted text-muted-foreground",
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <Badge variant="outline" className={cn(STATUS_STYLE[status], className)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const PRIORITY_STYLE: Record<Priority, string> = {
  LOW: "text-muted-foreground",
  MEDIUM: "",
  HIGH: "border-orange-500/40 text-orange-700 dark:text-orange-300",
  CRITICAL: "border-destructive/50 bg-destructive/10 text-destructive font-semibold",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge variant="outline" className={PRIORITY_STYLE[priority]}>
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}
