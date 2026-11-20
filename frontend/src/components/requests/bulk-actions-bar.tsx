"use client";

import { BanIcon, CheckIcon, CircleXIcon, Loader2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ReasonDialog } from "@/components/requests/reason-dialog";
import { Button } from "@/components/ui/button";
import { type BulkAction, type BulkActionResult, useBulkAction } from "@/hooks/use-requests";
import { ApiError } from "@/lib/api";
import { isFinal, type ServiceRequest } from "@/lib/types";

const plural = (n: number) => `${n} request${n === 1 ? "" : "s"}`;
const DONE: Record<BulkAction, string> = { approve: "Approved", reject: "Rejected", cancel: "Cancelled" };

/** Toast for a bulk result: what happened, and why any were skipped (by request code). */
function report(r: BulkActionResult, codes: Map<string, string>) {
  const skipped = r.failed.map((f) => `${codes.get(f.id) ?? "A request"}: ${f.message}`).join("\n");
  if (r.succeeded.length === 0) {
    toast.error(`Nothing was ${DONE[r.action].toLowerCase()}`, { description: skipped });
  } else if (r.failed.length > 0) {
    toast.warning(`${DONE[r.action]} ${plural(r.succeeded.length)}, skipped ${r.failed.length}`, { description: skipped });
  } else {
    toast.success(`${DONE[r.action]} ${plural(r.succeeded.length)}`);
  }
}

/**
 * Actions for the rows selected in the requests list. Each button counts only
 * the selected requests it applies to (e.g. Approve: awaiting approval and not
 * submitted by you); the server checks every one again.
 */
export function BulkActionsBar({
  selected,
  meId,
  staff,
  onDone,
  onClear,
}: {
  selected: ServiceRequest[];
  meId: string | undefined;
  staff: boolean;
  /** Called after an action, with the ids it changed, to drop them from the selection. */
  onDone: (changedIds: string[]) => void;
  onClear: () => void;
}) {
  const bulk = useBulkAction();
  const [dialog, setDialog] = useState<"reject" | "cancel" | null>(null);

  const decidable = selected.filter((r) => r.status === "AWAITING_APPROVAL" && r.operatorId !== meId);
  const cancellable = selected.filter((r) => !isFinal(r.status) && (staff || r.operatorId === meId));
  const codes = new Map(selected.map((r) => [r.id, r.code]));

  const run = (action: BulkAction, targets: ServiceRequest[], reason?: string) =>
    bulk.mutate(
      { action, items: targets.map((r) => ({ id: r.id, version: r.version })), reason: reason || undefined },
      {
        onSuccess: (r) => {
          report(r, codes);
          onDone(r.succeeded);
          setDialog(null);
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't update these requests"),
      },
    );

  const pending = (a: BulkAction) => bulk.isPending && bulk.variables?.action === a;

  return (
    <div
      role="toolbar"
      aria-label="Actions for selected requests"
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2"
    >
      <span className="mr-auto text-sm font-medium" aria-live="polite">
        {selected.length} selected
      </span>
      {staff && (
        <>
          <Button size="sm" onClick={() => run("approve", decidable)} disabled={decidable.length === 0 || bulk.isPending}>
            {pending("approve") ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            Approve{decidable.length > 0 && ` (${decidable.length})`}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialog("reject")}
            disabled={decidable.length === 0 || bulk.isPending}
          >
            <XIcon /> Reject{decidable.length > 0 && ` (${decidable.length})`}
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant="outline"
        className="text-destructive"
        onClick={() => setDialog("cancel")}
        disabled={cancellable.length === 0 || bulk.isPending}
      >
        <BanIcon /> Cancel{cancellable.length > 0 && ` (${cancellable.length})`}
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} disabled={bulk.isPending}>
        Clear
      </Button>

      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Reject ${plural(decidable.length)}?`}
        icon={<CircleXIcon />}
        description="Every submitter sees this reason. Rejected requests can't be reopened. Requests you submitted yourself aren't included."
        label="Reason"
        confirmLabel="Reject requests"
        required
        destructive
        pending={pending("reject")}
        onConfirm={(reason) => run("reject", decidable, reason)}
      />
      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Cancel ${plural(cancellable.length)}?`}
        icon={<BanIcon />}
        description="Queued work is dropped, and running work stops at its next step. This can't be undone."
        label="Reason"
        confirmLabel="Cancel requests"
        destructive
        pending={pending("cancel")}
        onConfirm={(reason) => run("cancel", cancellable, reason)}
      />
    </div>
  );
}
