"use client";

import { BanIcon, CheckIcon, CircleXIcon, Loader2Icon, RotateCcwIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ReasonDialog } from "@/components/requests/reason-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/use-auth";
import {
  type RequestUpdate,
  useApproveRequest,
  useCancelRequest,
  useRejectRequest,
  useRetryRequest,
  useUpdateRequest,
} from "@/hooks/use-requests";
import { ApiError } from "@/lib/api";
import { PRIORITY_LABEL } from "@/lib/labels";
import { isFinal, PRIORITIES, type Priority, type ServiceRequest } from "@/lib/types";

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

/**
 * Supervisor/admin controls for one request. A new request needs approval
 * from a supervisor or admin who did not submit it; after that the CPUs drive
 * status and progress, and staff steer them: priority (queue order), notes,
 * cancel, and retry after a failure. Every change sends the version shown on
 * screen; if the request changed meanwhile, the server refuses (409), the
 * toast says so, and the latest version loads.
 */
export function StaffControls({ request }: { request: ServiceRequest }) {
  const update = useUpdateRequest(request.id);
  const cancel = useCancelRequest(request.id);
  const retry = useRetryRequest(request.id);
  const approve = useApproveRequest(request.id);
  const reject = useRejectRequest(request.id);
  const { data: me } = useMe();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");

  const send = (change: Omit<RequestUpdate, "version">, success: string, after?: () => void) =>
    update.mutate(
      { version: request.version, ...change },
      {
        onSuccess: () => {
          toast.success(success);
          after?.();
        },
        onError: (err) => toast.error(errorText(err)),
      },
    );

  const finished = isFinal(request.status);
  const awaiting = request.status === "AWAITING_APPROVAL";
  // Four-eyes rule (enforced by the server too): nobody approves their own request.
  const ownRequest = request.operatorId === me?.id;
  const busy = update.isPending || cancel.isPending || retry.isPending || approve.isPending || reject.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage request</CardTitle>
        <CardDescription>
          {awaiting
            ? "This request needs approval before a CPU starts on it."
            : finished
              ? "Changes are shown to the submitter and other staff instantly."
              : "The CPUs process this automatically. You can reprioritise, add notes or cancel."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {awaiting &&
          (ownRequest ? (
            <div className="flex gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 text-sm">
              <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
              <p>You submitted this request, so another supervisor or admin has to approve it.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  approve.mutate(
                    { version: request.version },
                    {
                      onSuccess: () => toast.success("Approved: queued for processing"),
                      onError: (err) => toast.error(errorText(err)),
                    },
                  )
                }
                disabled={busy}
              >
                {approve.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
                Approve
              </Button>
              <Button variant="outline" className="text-destructive" onClick={() => setRejectOpen(true)} disabled={busy}>
                <XIcon /> Reject
              </Button>
            </div>
          ))}

        {request.status === "FAILED" && (
          <div className="space-y-2">
            <Button
              onClick={() =>
                retry.mutate(
                  { version: request.version },
                  {
                    onSuccess: () => toast.success("Queued again for processing"),
                    onError: (err) => toast.error(errorText(err)),
                  },
                )
              }
              disabled={busy}
            >
              {retry.isPending ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}
              Retry request
            </Button>
            <p className="text-xs text-muted-foreground">Runs it again from the start, with a fresh set of attempts.</p>
          </div>
        )}

        {!finished && (
          <>
            <Field>
              <FieldLabel htmlFor="priority">Priority</FieldLabel>
              <Select
                value={request.priority}
                onValueChange={(v) =>
                  v &&
                  v !== request.priority &&
                  send({ priority: v as Priority }, `Priority set to ${PRIORITY_LABEL[v as Priority]}`)
                }
                disabled={busy}
              >
                <SelectTrigger id="priority" className="w-full sm:w-48">
                  <SelectValue>{(v: Priority) => PRIORITY_LABEL[v]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {request.status === "PENDING" && (
                <FieldDescription>Higher priority requests are picked up first.</FieldDescription>
              )}
            </Field>
            <Button variant="ghost" className="-ml-2 text-destructive" onClick={() => setCancelOpen(true)} disabled={busy}>
              Cancel request
            </Button>
          </>
        )}

        <Separator />
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) send({ note: note.trim() }, "Note added", () => setNote(""));
          }}
        >
          <Field>
            <FieldLabel htmlFor="note">Add a note to the timeline</FieldLabel>
            <Textarea id="note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button type="submit" variant="outline" size="sm" disabled={busy || !note.trim()}>
            Add note
          </Button>
        </form>
      </CardContent>

      <ReasonDialog
        // Closes by itself if someone else decides first.
        open={rejectOpen && awaiting}
        onOpenChange={setRejectOpen}
        title="Reject this request?"
        icon={<CircleXIcon />}
        description="The submitter will see your reason. Rejected requests can't be reopened; they can submit a new one."
        label="Reason"
        confirmLabel="Reject request"
        required
        destructive
        pending={reject.isPending}
        onConfirm={(reason) =>
          reject.mutate(
            { version: request.version, reason },
            {
              onSuccess: () => {
                toast.success("Request rejected");
                setRejectOpen(false);
              },
              onError: (err) => {
                toast.error(errorText(err));
                setRejectOpen(false);
              },
            },
          )
        }
      />
      <ReasonDialog
        // Closes by itself if the request finishes while the dialog is open.
        open={cancelOpen && !finished}
        onOpenChange={setCancelOpen}
        title="Cancel this request?"
        icon={<BanIcon />}
        description={
          request.status === "IN_PROGRESS"
            ? "The CPU stops at its current step. Cancelled requests can't be reopened."
            : "It will be taken out of the queue. Cancelled requests can't be reopened."
        }
        label="Reason"
        confirmLabel="Cancel request"
        destructive
        pending={cancel.isPending}
        onConfirm={(reason) =>
          cancel.mutate(
            { version: request.version, reason: reason || undefined },
            {
              onSuccess: () => {
                toast.success("Request cancelled");
                setCancelOpen(false);
              },
              onError: (err) => {
                toast.error(errorText(err));
                setCancelOpen(false);
              },
            },
          )
        }
      />
    </Card>
  );
}
