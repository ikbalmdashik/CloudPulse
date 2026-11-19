"use client";

import { CheckIcon, Loader2Icon, PlayIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ReasonDialog } from "@/components/requests/reason-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { type RequestUpdate, useCancelRequest, useUpdateRequest } from "@/hooks/use-requests";
import { ApiError } from "@/lib/api";
import { PRIORITY_LABEL } from "@/lib/labels";
import { PRIORITIES, type Priority, type ServiceRequest } from "@/lib/types";

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

/**
 * Supervisor/admin controls for one request. Every change sends the version
 * shown on screen; if someone else changed the request in the meantime, the
 * server refuses (409), the toast says so, and the latest version loads.
 */
export function StaffControls({ request }: { request: ServiceRequest }) {
  const update = useUpdateRequest(request.id);
  const cancel = useCancelRequest(request.id);
  const [dialog, setDialog] = useState<"fail" | "cancel" | null>(null);
  // Local edits start from the live values; the key on this component (the
  // version) resets them whenever the request changes on the server.
  const [progress, setProgress] = useState(request.progress);
  const [step, setStep] = useState(request.currentStep ?? "");
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

  const inProgress = request.status === "IN_PROGRESS";
  const busy = update.isPending || cancel.isPending;
  const progressChanged = progress !== request.progress || step.trim() !== (request.currentStep ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage request</CardTitle>
        <CardDescription>Changes are shown to the submitter and other staff instantly.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {request.status === "PENDING" && (
            <Button onClick={() => send({ status: "IN_PROGRESS", currentStep: "Started" }, "Work started")} disabled={busy}>
              {update.isPending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
              Start work
            </Button>
          )}
          {inProgress && (
            <>
              <Button onClick={() => send({ status: "COMPLETED" }, "Marked as completed")} disabled={busy}>
                <CheckIcon /> Complete
              </Button>
              <Button variant="outline" onClick={() => setDialog("fail")} disabled={busy}>
                <XIcon /> Mark failed
              </Button>
            </>
          )}
          <Button variant="ghost" className="text-destructive" onClick={() => setDialog("cancel")} disabled={busy}>
            Cancel request
          </Button>
        </div>

        {inProgress && (
          <>
            <Separator />
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                send({ progress, currentStep: step.trim() || null }, "Progress updated");
              }}
            >
              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="progress">Progress</FieldLabel>
                  <span className="text-sm tabular-nums text-muted-foreground">{progress}%</span>
                </div>
                <Slider
                  id="progress"
                  value={[progress]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(v) => setProgress(Array.isArray(v) ? v[0]! : v)}
                  aria-label="Progress percentage"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="step">Current step</FieldLabel>
                <Input
                  id="step"
                  value={step}
                  maxLength={200}
                  placeholder="e.g. Installing packages"
                  onChange={(e) => setStep(e.target.value)}
                />
              </Field>
              <Button type="submit" variant="secondary" disabled={busy || !progressChanged}>
                Update progress
              </Button>
            </form>
          </>
        )}

        <Separator />
        <Field>
          <FieldLabel htmlFor="priority">Priority</FieldLabel>
          <Select
            value={request.priority}
            onValueChange={(v) =>
              v && v !== request.priority && send({ priority: v as Priority }, `Priority set to ${PRIORITY_LABEL[v as Priority]}`)
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
        </Field>

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
        open={dialog === "fail"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Mark this request as failed?"
        description="The submitter will see the reason. Failed requests can't be reopened."
        label="What went wrong"
        confirmLabel="Mark failed"
        required
        destructive
        pending={update.isPending}
        onConfirm={(reason) => send({ status: "FAILED", errorReason: reason }, "Marked as failed", () => setDialog(null))}
      />
      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Cancel this request?"
        description="Cancelled requests can't be reopened."
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
                setDialog(null);
              },
              onError: (err) => toast.error(errorText(err)),
            },
          )
        }
      />
    </Card>
  );
}
