"use client";

import { BanIcon, CircleAlertIcon, CpuIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PriorityBadge, StatusBadge } from "@/components/requests/badges";
import { ReasonDialog } from "@/components/requests/reason-dialog";
import { StaffControls } from "@/components/requests/staff-controls";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/use-auth";
import { useCancelRequest, useRequest } from "@/hooks/use-requests";
import { ApiError } from "@/lib/api";
import { CATEGORY_LABEL, ENVIRONMENT_LABEL, STATUS_LABEL } from "@/lib/labels";
import { isFinal, isStaff, type JobSummary, type RequestDetail, type RequestEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const fmt = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : "—");

function Timeline({ events }: { events: RequestEvent[] }) {
  return (
    <ol className="relative space-y-5 border-l pl-5" aria-live="polite">
      {[...events].reverse().map((e, i) => (
        <li key={e.id} className="relative">
          <span
            className={cn(
              "absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-background",
              i === 0 ? "bg-primary" : "bg-muted-foreground/40",
            )}
            aria-hidden
          />
          <p className="text-sm">{e.message}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {e.actor ? `${e.actor.fullName} · ` : "System · "}
            <time dateTime={e.createdAt}>{fmt(e.createdAt)}</time>
          </p>
        </li>
      ))}
    </ol>
  );
}

const JOB_STATUS: Record<JobSummary["status"], string> = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/** Which background worker has (or had) the request, and which attempt. */
function ProcessingLine({ job, status }: { job: JobSummary; status: RequestDetail["status"] }) {
  const attempt = `attempt ${job.attempt} of ${job.maxAttempts}`;
  // The worker publishes a request's final status a moment before it closes
  // its job, so for a finished request describe the job in the past tense.
  const finished = isFinal(status);
  const text =
    status === "CANCELLED" && !job.startedAt
      ? "Taken out of the queue before a worker started it"
      : finished && job.workerId
        ? `Processed by ${job.workerId} (${attempt})`
        : job.status === "RUNNING"
          ? `Being processed by ${job.workerId ?? "a CPU"} (${attempt})`
          : job.status === "QUEUED"
            ? `In the queue (${attempt})`
            : `Last job ${JOB_STATUS[job.status]} (${attempt}${job.workerId ? `, ${job.workerId}` : ""})`;
  const spinning = job.status === "RUNNING" && !finished;
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      {spinning ? (
        <Loader2Icon className="size-4 animate-spin" aria-hidden />
      ) : (
        <CpuIcon className="size-4" aria-hidden />
      )}
      {text}
    </p>
  );
}

const resultLabel = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

/** What the worker produced, e.g. the new VM's id and IP. */
function ResultList({ result }: { result: NonNullable<RequestDetail["result"]> }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <p className="mb-2 font-medium">Result</p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {Object.entries(result).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 sm:block">
            <dt className="text-muted-foreground">{resultLabel(k)}</dt>
            <dd className="font-mono break-all">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SubmitterActions({ request }: { request: RequestDetail }) {
  const cancel = useCancelRequest(request.id);
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Need to stop this?</CardTitle>
        <CardDescription>You can cancel your request until it has finished.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
          Cancel request
        </Button>
      </CardContent>
      <ReasonDialog
        // Closes by itself if the request finishes while the dialog is open.
        open={open && !isFinal(request.status)}
        onOpenChange={setOpen}
        title="Cancel this request?"
        icon={<BanIcon />}
        description="The operations team will stop working on it. This can't be undone."
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
                setOpen(false);
              },
              onError: (err) => {
                toast.error(err instanceof ApiError ? err.message : "Couldn't cancel the request");
                setOpen(false);
              },
            },
          )
        }
      />
    </Card>
  );
}

export function RequestDetailView() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const query = useRequest(id);

  if (query.isPending) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-8 w-2/3" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Alert variant={notFound ? "default" : "destructive"}>
        <CircleAlertIcon />
        <AlertTitle>{notFound ? "Request not found" : "Couldn't load this request"}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{notFound ? "It doesn't exist, or it isn't one of yours." : query.error.message}</p>
          <Link href="/requests" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Back to requests
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const r = query.data;
  const job = r.jobs?.[0];
  const staff = isStaff(me?.role);
  const mine = r.operatorId === me?.id;
  const done = isFinal(r.status);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
          <StatusBadge status={r.status} />
          <PriorityBadge priority={r.priority} />
        </div>
        <p className="font-mono text-sm text-muted-foreground">{r.code}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
              <CardDescription aria-live="polite">
                {r.status === "IN_PROGRESS"
                  ? r.currentStep || "In progress"
                  : r.status === "PENDING"
                    ? "Approved and queued: waiting for a free CPU"
                    : r.status === "AWAITING_APPROVAL"
                      ? "Waiting for approval from a supervisor or admin"
                      : STATUS_LABEL[r.status]}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Progress value={r.progress} className="flex-1" aria-label={`${r.progress}% complete`} />
                <span className="w-10 text-right text-sm tabular-nums">{r.progress}%</span>
              </div>
              {job && <ProcessingLine job={job} status={r.status} />}
              {r.status === "REJECTED" && r.errorReason && (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertTitle>Rejected</AlertTitle>
                  <AlertDescription>{r.errorReason}</AlertDescription>
                </Alert>
              )}
              {r.status === "FAILED" && r.errorReason && (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertTitle>Failed</AlertTitle>
                  <AlertDescription>{r.errorReason}</AlertDescription>
                </Alert>
              )}
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Category</dt>
                  <dd>{CATEGORY_LABEL[r.category]}</dd>
                </div>
                {r.payload?.environment && (
                  <div>
                    <dt className="text-muted-foreground">Environment</dt>
                    <dd>{ENVIRONMENT_LABEL[r.payload.environment]}</dd>
                  </div>
                )}
                {r.payload?.target && (
                  <div>
                    <dt className="text-muted-foreground">Target</dt>
                    <dd className="font-mono break-all">{r.payload.target}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">Submitted by</dt>
                  <dd>{r.operator?.fullName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Submitted</dt>
                  <dd>{fmt(r.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Approved</dt>
                  <dd>
                    {r.approvedAt
                      ? `${fmt(r.approvedAt)}${r.approvedBy ? ` by ${r.approvedBy.fullName}` : ""}`
                      : r.status === "AWAITING_APPROVAL"
                        ? "Not yet"
                        : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Started</dt>
                  <dd>{fmt(r.startedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Finished</dt>
                  <dd>{fmt(r.completedAt)}</dd>
                </div>
              </dl>
              {r.status === "COMPLETED" && r.result && <ResultList result={r.result} />}
              {r.description && (
                <div className="text-sm">
                  <p className="text-muted-foreground">Details</p>
                  <p className="mt-1 whitespace-pre-wrap">{r.description}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
              <CardDescription>Newest first. New entries appear as they happen.</CardDescription>
            </CardHeader>
            <CardContent>
              <Timeline events={r.events} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Not keyed by version: workers change the request while staff may be typing a
              note or have the cancel dialog open, and that must not reset. Actions always
              send the latest version, which live updates keep current. */}
          {staff && <StaffControls request={r} />}
          {!staff && mine && !done && <SubmitterActions request={r} />}
          {!staff && done && (
            <Card>
              <CardHeader>
                <CardTitle>Finished</CardTitle>
                <CardDescription>
                  This request is {STATUS_LABEL[r.status].toLowerCase()} and can no longer change.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
