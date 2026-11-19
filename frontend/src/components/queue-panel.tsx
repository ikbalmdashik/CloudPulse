"use client";

import { CpuIcon } from "lucide-react";
import Link from "next/link";
import { requestsHref } from "@/components/requests/requests-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueueStats } from "@/hooks/use-requests";
import { STATUS_LABEL } from "@/lib/labels";
import { STATUSES } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONE: Record<(typeof STATUSES)[number], string> = {
  AWAITING_APPROVAL: "text-violet-600 dark:text-violet-400",
  PENDING: "text-amber-600 dark:text-amber-400",
  IN_PROGRESS: "text-sky-600 dark:text-sky-400",
  COMPLETED: "text-emerald-600 dark:text-emerald-400",
  FAILED: "text-destructive",
  CANCELLED: "text-muted-foreground",
  REJECTED: "text-destructive",
};

/**
 * Supervisors and admins: the processing queue at a glance. Refreshed
 * whenever the server pushes a request change over the WebSocket.
 */
export function QueuePanel() {
  const stats = useQueueStats(true);

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>Processing queue</CardTitle>
        <CardDescription>Live: updates as requests are approved and the CPUs pick them up and finish them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {stats.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : stats.isError ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load queue stats: {stats.error.message}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
              {STATUSES.map((s) => (
                <Link
                  key={s}
                  href={requestsHref(s)}
                  className="rounded-lg border p-3 transition-colors hover:bg-muted"
                  aria-label={`${stats.data.requests[s] ?? 0} ${STATUS_LABEL[s]}: show these requests`}
                >
                  <dt className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</dt>
                  <dd className={cn("text-2xl font-semibold tabular-nums", TONE[s])}>{stats.data.requests[s] ?? 0}</dd>
                </Link>
              ))}
            </dl>

            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                <CpuIcon className="size-4" aria-hidden />
                CPUs: {stats.data.workers.enabled ? `${stats.data.workers.busy} of ${stats.data.workers.concurrency} busy` : "processing is disabled on this server"}
              </p>
              {stats.data.workers.enabled && (
                <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {Array.from({ length: stats.data.workers.concurrency }, (_, i) => {
                    const name = `CPU-${i + 1}`;
                    const slot = stats.data.workers.slots.find((s) => s.name === name);
                    return (
                      <li key={name} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                        <span
                          className={cn("size-2 rounded-full", slot ? "animate-pulse bg-sky-500" : "bg-muted-foreground/30")}
                          aria-hidden
                        />
                        <span className="font-mono text-xs">{name}</span>
                        {slot ? (
                          <Link href={`/requests/${slot.requestId}`} className="ml-auto text-xs underline-offset-4 hover:underline">
                            busy · attempt {slot.attempt}
                          </Link>
                        ) : (
                          <span className="ml-auto text-xs text-muted-foreground">idle</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {(stats.data.jobs.QUEUED ?? 0) > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {stats.data.jobs.QUEUED} approved job{stats.data.jobs.QUEUED === 1 ? "" : "s"} waiting for a free CPU (including retries).
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
