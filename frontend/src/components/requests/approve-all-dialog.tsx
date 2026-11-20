"use client";

import { CheckCheckIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogMedia,
  DialogTitle,
} from "@/components/ui/dialog";
import { type ApproveAllInput, type ApproveAllResult, useApproveAll } from "@/hooks/use-requests";
import { ApiError } from "@/lib/api";
import { CATEGORY_LABEL, PRIORITY_LABEL, SINCE_LABEL } from "@/lib/labels";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One line for the toast after a bulk approval. */
function summary(r: ApproveAllResult) {
  const notes = [
    r.skippedOwn && `${plural(r.skippedOwn, "request")} you submitted need another approver`,
    r.skippedChanged && `${plural(r.skippedChanged, "request")} changed meanwhile and ${r.skippedChanged === 1 ? "was" : "were"} left alone`,
    r.remaining && `${r.remaining} more still waiting; click Approve all again`,
  ].filter(Boolean);
  return notes.join(". ") || undefined;
}

/**
 * "Approve all" for the requests list (supervisors and admins): approves
 * every request awaiting approval that matches the current filters, not just
 * the page on screen. `count` is how many match right now, including the
 * user's own (which are skipped).
 */
export function ApproveAllButton({
  filter,
  count,
}: {
  filter: Omit<ApproveAllInput, "asOf">;
  count: number;
}) {
  const approveAll = useApproveAll();
  // Fixed when the dialog opens: requests submitted after that are never approved unseen.
  const [asOf, setAsOf] = useState<string | null>(null);

  const scope = [
    filter.since && SINCE_LABEL[filter.since].toLowerCase().replace(/^last/, "submitted in the last"),
    filter.priority && `${PRIORITY_LABEL[filter.priority]} priority`,
    filter.category && CATEGORY_LABEL[filter.category],
    filter.search && `matching \u201c${filter.search}\u201d`,
  ].filter(Boolean);

  const confirm = () => {
    if (!asOf) return;
    approveAll.mutate(
      { ...filter, asOf },
      {
        onSuccess: (r) => {
          if (r.approved > 0) toast.success(`Approved ${plural(r.approved, "request")}`, { description: summary(r) });
          else toast.info("Nothing was approved", { description: summary(r) ?? "No matching requests are awaiting approval." });
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't approve these requests"),
        onSettled: () => setAsOf(null),
      },
    );
  };

  return (
    <>
      <Button variant="outline" onClick={() => setAsOf(new Date().toISOString())} disabled={count === 0}>
        <CheckCheckIcon /> Approve all{count > 0 && ` (${count})`}
      </Button>
      <Dialog open={asOf !== null} onOpenChange={(open) => !open && !approveAll.isPending && setAsOf(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogMedia tone="success">
              <CheckCheckIcon />
            </DialogMedia>
            <DialogTitle>Approve {plural(count, "request")}?</DialogTitle>
            <DialogDescription>
              Every request awaiting approval{scope.length ? ` ${scope.join(", ")}` : ""} will be approved and queued for
              processing, including those not on this page. Requests you submitted yourself are skipped, and anything
              submitted after you opened this dialog is left for review.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={approveAll.isPending} />}>Cancel</DialogClose>
            <Button onClick={confirm} disabled={approveAll.isPending}>
              {approveAll.isPending && <Loader2Icon className="animate-spin" />}
              Approve all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
