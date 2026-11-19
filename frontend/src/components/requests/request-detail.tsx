"use client";

import { CircleAlertIcon } from "lucide-react";
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
import { isFinal, isStaff, type RequestDetail, type RequestEvent } from "@/lib/types";
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
            {e.actor ? `${e.actor.fullName} · ` : ""}
            <time dateTime={e.createdAt}>{fmt(e.createdAt)}</time>
          </p>
        </li>
      ))}
    </ol>
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
        open={open}
        onOpenChange={setOpen}
        title="Cancel this request?"
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
                    ? "Waiting for the operations team to pick it up"
                    : STATUS_LABEL[r.status]}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Progress value={r.progress} className="flex-1" aria-label={`${r.progress}% complete`} />
                <span className="w-10 text-right text-sm tabular-nums">{r.progress}%</span>
              </div>
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
                  <dt className="text-muted-foreground">Started</dt>
                  <dd>{fmt(r.startedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Finished</dt>
                  <dd>{fmt(r.completedAt)}</dd>
                </div>
              </dl>
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
          {/* key: reset the form fields whenever the request changes on the server */}
          {staff && !done && <StaffControls key={r.version} request={r} />}
          {!staff && mine && !done && <SubmitterActions request={r} />}
          {done && (
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
