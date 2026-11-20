"use client";

import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ApproveAllButton } from "@/components/requests/approve-all-dialog";
import { BulkActionsBar } from "@/components/requests/bulk-actions-bar";
import { PriorityBadge, StatusBadge } from "@/components/requests/badges";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMe } from "@/hooks/use-auth";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useRequests } from "@/hooks/use-requests";
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  SINCE_LABEL,
  SINCE_OPTIONS,
  SINCE_VALUES,
  type SinceWindow,
  STATUS_LABEL,
} from "@/lib/labels";
import { CATEGORIES, type Category, isStaff, PRIORITIES, type Priority, STATUSES, type Status } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 15;
const ALL = "ALL";
const ACTIVE = "ACTIVE";
const ANY_TIME = "ANY";
type StatusFilter = Status | typeof ALL | typeof ACTIVE;

/** A query-string value, if it is one of `allowed`. */
function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Link to the requests list with a status filter applied, e.g. from the
 * dashboard's queue panel: `/requests?status=PENDING`.
 */
export function requestsHref(status?: StatusFilter): string {
  return !status || status === ACTIVE ? "/requests" : `/requests?status=${status}`;
}

const timeFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function ago(iso: string) {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return timeFmt.format(Math.round(s), "second");
  if (abs < 3600) return timeFmt.format(Math.round(s / 60), "minute");
  if (abs < 86400) return timeFmt.format(Math.round(s / 3600), "hour");
  return timeFmt.format(Math.round(s / 86400), "day");
}

function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  render,
  className,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  render: (v: T) => string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as T)}>
      <SelectTrigger className={cn("w-full sm:w-40", className)} aria-label={label}>
        <SelectValue>{(v: T) => render(v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function RequestsList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: me } = useMe();
  const staff = isStaff(me?.role);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());

  // Filters and page live in the URL (?status=PENDING&category=…&page=2), so
  // links from elsewhere (the dashboard's queue panel) open the list already
  // filtered, and Back/refresh/shared links keep the same view.
  const status: StatusFilter = pick(params.get("status"), [ALL, ...STATUSES]) ?? ACTIVE;
  const category: Category | typeof ALL = pick(params.get("category"), CATEGORIES) ?? ALL;
  const priority: Priority | typeof ALL = pick(params.get("priority"), PRIORITIES) ?? ALL;
  const since: SinceWindow | typeof ANY_TIME = pick(params.get("since"), SINCE_VALUES) ?? ANY_TIME;
  const page = Math.max(0, (Number.parseInt(params.get("page") ?? "1", 10) || 1) - 1);

  /** Updates the query string. Any filter change goes back to page 1. */
  const setQuery = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in changes)) next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const setStatus = (v: StatusFilter) => setQuery({ status: v === ACTIVE ? null : v });
  const setCategory = (v: Category | typeof ALL) => setQuery({ category: v === ALL ? null : v });
  const setPriority = (v: Priority | typeof ALL) => setQuery({ priority: v === ALL ? null : v });
  const setSince = (v: SinceWindow | typeof ANY_TIME) => setQuery({ since: v === ANY_TIME ? null : v });
  const setPage = (p: number) => setQuery({ page: p === 0 ? null : String(p + 1) });

  const requests = useRequests({
    search: debouncedSearch || undefined,
    status: status === ALL || status === ACTIVE ? undefined : status,
    active: status === ACTIVE || undefined,
    category: category === ALL ? undefined : category,
    priority: priority === ALL ? undefined : priority,
    since: since === ANY_TIME ? undefined : since,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  // "Approve all" acts on the requests awaiting approval among these filters,
  // so it shows when the status filter can include them.
  const bulkFilter = {
    search: debouncedSearch || undefined,
    category: category === ALL ? undefined : category,
    priority: priority === ALL ? undefined : priority,
    since: since === ANY_TIME ? undefined : since,
  };
  const canApproveAll = staff && (status === ACTIVE || status === ALL || status === "AWAITING_APPROVAL");
  const awaiting = useRequests(
    { ...bulkFilter, status: "AWAITING_APPROVAL", limit: 1, offset: 0 },
    { enabled: canApproveAll },
  );

  // Selected rows belong to this exact view: changing a filter, the search or
  // the page clears them, so an action never touches rows you can't see.
  const view = `${params.toString()}|${debouncedSearch}`;
  const [selection, setSelection] = useState<{ view: string; ids: Set<string> }>({ view, ids: new Set() });
  const selectedIds = selection.view === view ? selection.ids : new Set<string>();
  const items = requests.data?.items ?? [];
  const selectedRows = items.filter((r) => selectedIds.has(r.id));
  const allSelected = items.length > 0 && selectedRows.length === items.length;
  const setSelected = (ids: Iterable<string>) => setSelection({ view, ids: new Set(ids) });
  const toggle = (id: string, on: boolean) =>
    setSelected(on ? [...selectedIds, id] : [...selectedIds].filter((x) => x !== id));

  const total = requests.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{staff ? "All requests" : "My requests"}</h1>
          <p className="text-sm text-muted-foreground">
            {staff
              ? "Every request from every operator. Changes appear here the moment they happen."
              : "Requests you've submitted. Status and progress update live."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canApproveAll && <ApproveAllButton filter={bulkFilter} count={awaiting.data?.total ?? 0} />}
          <Link href="/requests/new" className={buttonVariants()}>
            <PlusIcon /> New request
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader className="gap-4">
          <div>
            <CardTitle>Requests</CardTitle>
            <CardDescription aria-live="polite">
              {requests.isPending ? "Loading…" : `${total} ${total === 1 ? "request" : "requests"}`}
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row">
            <div className="relative lg:max-w-xs lg:flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search code or title"
                aria-label="Search requests by code or title"
                className="pl-8"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (page !== 0) setPage(0);
                }}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:flex">
              <FilterSelect<StatusFilter>
                label="Filter by status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: ACTIVE, label: "Active" },
                  { value: ALL, label: "All statuses" },
                  ...STATUSES.map((s) => ({ value: s as StatusFilter, label: STATUS_LABEL[s] })),
                ]}
                render={(v) => (v === ACTIVE ? "Active" : v === ALL ? "All statuses" : STATUS_LABEL[v])}
              />
              <FilterSelect<Category | typeof ALL>
                label="Filter by category"
                value={category}
                onChange={setCategory}
                className="sm:w-44"
                options={[
                  { value: ALL, label: "All categories" },
                  ...CATEGORIES.map((c) => ({ value: c as Category | typeof ALL, label: CATEGORY_LABEL[c] })),
                ]}
                render={(v) => (v === ALL ? "All categories" : CATEGORY_LABEL[v])}
              />
              <FilterSelect<Priority | typeof ALL>
                label="Filter by priority"
                value={priority}
                onChange={setPriority}
                options={[
                  { value: ALL, label: "All priorities" },
                  ...PRIORITIES.map((p) => ({ value: p as Priority | typeof ALL, label: PRIORITY_LABEL[p] })),
                ]}
                render={(v) => (v === ALL ? "All priorities" : PRIORITY_LABEL[v])}
              />
              <FilterSelect<SinceWindow | typeof ANY_TIME>
                label="Filter by when it was submitted"
                value={since}
                onChange={setSince}
                options={[
                  { value: ANY_TIME, label: "Any time" },
                  ...SINCE_OPTIONS.map((o) => ({ value: o.value as SinceWindow | typeof ANY_TIME, label: o.label })),
                ]}
                render={(v) => (v === ANY_TIME ? "Any time" : SINCE_LABEL[v])}
              />
            </div>
          </div>
          {selectedRows.length > 0 && (
            <BulkActionsBar
              selected={selectedRows}
              meId={me?.id}
              staff={staff}
              onDone={(changed) => setSelected([...selectedIds].filter((id) => !changed.includes(id)))}
              onClear={() => setSelected([])}
            />
          )}
        </CardHeader>

        <CardContent className="px-0">
          {requests.isError ? (
            <div className="px-6 py-8 text-center text-sm">
              <p className="font-medium">Couldn&apos;t load requests.</p>
              <p className="mt-1 text-muted-foreground">{requests.error.message}</p>
              <Button className="mt-4" variant="outline" size="sm" onClick={() => requests.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-6">
                      <Checkbox
                        aria-label="Select all requests on this page"
                        checked={allSelected}
                        indeterminate={selectedRows.length > 0 && !allSelected}
                        disabled={items.length === 0}
                        onCheckedChange={(on) => setSelected(on ? items.map((r) => r.id) : [])}
                      />
                    </TableHead>
                    <TableHead>Request</TableHead>
                    <TableHead className="hidden md:table-cell">Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden w-40 lg:table-cell">Progress</TableHead>
                    {staff && <TableHead className="hidden xl:table-cell">Submitted by</TableHead>}
                    <TableHead className="hidden pr-6 sm:table-cell">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={requests.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
                  {requests.isPending &&
                    Array.from({ length: 4 }, (_, i) => (
                      <TableRow key={i}>
                        <TableCell className="pl-6" colSpan={7}>
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ))}
                  {requests.data?.items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                        {status === ACTIVE && !debouncedSearch && category === ALL && priority === ALL && since === ANY_TIME
                          ? "No active requests right now."
                          : "No requests match these filters."}
                      </TableCell>
                    </TableRow>
                  )}
                  {requests.data?.items.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      data-state={selectedIds.has(r.id) ? "selected" : undefined}
                      onClick={() => router.push(`/requests/${r.id}`)}
                    >
                      <TableCell className="w-10 pl-6" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select ${r.code}`}
                          checked={selectedIds.has(r.id)}
                          onCheckedChange={(on) => toggle(r.id, on === true)}
                        />
                      </TableCell>
                      <TableCell className="max-w-0 sm:max-w-none">
                        <Link
                          href={`/requests/${r.id}`}
                          className="block truncate font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.title}
                        </Link>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {r.code} · {CATEGORY_LABEL[r.category]}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <PriorityBadge priority={r.priority} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                        {r.status === "IN_PROGRESS" && r.currentStep && (
                          <div className="mt-1 max-w-40 truncate text-xs text-muted-foreground">{r.currentStep}</div>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex items-center gap-2">
                          <Progress value={r.progress} className="w-24" aria-label={`${r.progress}% complete`} />
                          <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                            {r.progress}%
                          </span>
                        </div>
                      </TableCell>
                      {staff && (
                        <TableCell className="hidden text-muted-foreground xl:table-cell">
                          {r.operator?.fullName ?? "—"}
                        </TableCell>
                      )}
                      <TableCell className="hidden pr-6 text-muted-foreground sm:table-cell">
                        <time dateTime={r.updatedAt} title={new Date(r.updatedAt).toLocaleString()}>
                          {ago(r.updatedAt)}
                        </time>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-2 border-t px-6 pt-4 text-sm">
              <span className="text-muted-foreground">
                Page {page + 1} of {pageCount}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setPage(page - 1)} disabled={page === 0} aria-label="Previous page">
                  <ChevronLeftIcon />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage(page + 1)}
                  disabled={page + 1 >= pageCount}
                  aria-label="Next page"
                >
                  <ChevronRightIcon />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
