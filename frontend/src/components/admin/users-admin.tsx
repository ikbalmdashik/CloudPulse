"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  ShieldAlertIcon,
  UserRoundCheckIcon,
  UserRoundMinusIcon,
  UserRoundPlusIcon,
  UserRoundXIcon,
} from "lucide-react";
import { useState } from "react";
import { RoleBadge, roleLabel } from "@/components/role-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMe } from "@/hooks/use-auth";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useUsers } from "@/hooks/use-users";
import { ROLES, type Role, type User } from "@/lib/types";
import { type RoleChange, RoleChangeDialog } from "./role-change-dialog";
import { UserStatusDialog } from "./user-status-dialog";

const PAGE_SIZE = 10;
const ALL = "ALL";
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function UsersAdmin() {
  const { data: me } = useMe();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role | typeof ALL>(ALL);
  const [page, setPage] = useState(0);
  const [change, setChange] = useState<RoleChange | null>(null);
  const [statusUser, setStatusUser] = useState<User | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim());

  const users = useUsers(
    {
      search: debouncedSearch || undefined,
      role: role === ALL ? undefined : role,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    },
    // Wait until we know the user is an admin; others would only get a 403.
    { enabled: me?.role === "ADMIN" },
  );

  // The backend enforces this too (403); this just avoids showing a broken page.
  if (me && me.role !== "ADMIN") {
    return (
      <Alert variant="destructive">
        <ShieldAlertIcon />
        <AlertTitle>Admins only</AlertTitle>
        <AlertDescription>You don&apos;t have permission to manage users.</AlertDescription>
      </Alert>
    );
  }

  const total = users.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Everyone who has signed up. Promote operators to supervisor to let them monitor all requests, or
          demote a supervisor back to operator.
        </p>
      </div>

      <Card>
        <CardHeader className="gap-4">
          <div>
            <CardTitle>All users</CardTitle>
            <CardDescription aria-live="polite">
              {users.isPending ? "Loading…" : `${total} ${total === 1 ? "user" : "users"}`}
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative sm:max-w-xs sm:flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search name or email"
                aria-label="Search users by name or email"
                className="pl-8"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <Select
              value={role}
              onValueChange={(v) => {
                setRole((v ?? ALL) as Role | typeof ALL);
                setPage(0);
              }}
            >
              <SelectTrigger className="sm:w-44" aria-label="Filter by role">
                <SelectValue>{(v: string) => (v === ALL ? "All roles" : roleLabel(v as Role))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All roles</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {roleLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="px-0">
          {users.isError ? (
            <div className="px-6 py-8 text-center text-sm">
              <p className="font-medium">Couldn&apos;t load users.</p>
              <p className="mt-1 text-muted-foreground">{users.error.message}</p>
              <Button className="mt-4" variant="outline" size="sm" onClick={() => users.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-busy={users.isFetching}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Name</TableHead>
                    <TableHead className="hidden md:table-cell">Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="hidden lg:table-cell">Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Joined</TableHead>
                    <TableHead className="pr-6 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={users.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
                  {users.isPending &&
                    Array.from({ length: 4 }, (_, i) => (
                      <TableRow key={i}>
                        <TableCell className="pl-6" colSpan={6}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))}
                  {users.data?.items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        No users match these filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {users.data?.items.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="pl-6">
                        <div className="font-medium">{u.fullName}</div>
                        <div className="text-xs text-muted-foreground md:hidden">{u.email}</div>
                        {!u.isActive && (
                          <Badge variant="destructive" className="mt-1 lg:hidden">
                            Deactivated
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{u.email}</TableCell>
                      <TableCell>
                        <RoleBadge role={u.role} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {u.isActive ? (
                          <span className="text-sm text-muted-foreground">Active</span>
                        ) : (
                          <Badge variant="destructive">Deactivated</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {dateFmt.format(new Date(u.createdAt))}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <div className="flex justify-end gap-2">
                          {u.role === "OPERATOR" && u.isActive && (
                            <Button size="sm" variant="outline" onClick={() => setChange({ user: u, role: "SUPERVISOR" })}>
                              <UserRoundCheckIcon />
                              <span className="hidden sm:inline">Promote</span>
                              <span className="sr-only sm:hidden">Promote {u.fullName} to supervisor</span>
                            </Button>
                          )}
                          {u.role === "SUPERVISOR" && u.isActive && (
                            <Button size="sm" variant="outline" onClick={() => setChange({ user: u, role: "OPERATOR" })}>
                              <UserRoundMinusIcon />
                              <span className="hidden sm:inline">Demote</span>
                              <span className="sr-only sm:hidden">Demote {u.fullName} to operator</span>
                            </Button>
                          )}
                          {/* Admin accounts (yours included) can't be deactivated here. */}
                          {u.role !== "ADMIN" &&
                            (u.isActive ? (
                              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setStatusUser(u)}>
                                <UserRoundXIcon />
                                <span className="hidden sm:inline">Deactivate</span>
                                <span className="sr-only sm:hidden">Deactivate {u.fullName}</span>
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => setStatusUser(u)}>
                                <UserRoundPlusIcon />
                                <span className="hidden sm:inline">Reactivate</span>
                                <span className="sr-only sm:hidden">Reactivate {u.fullName}</span>
                              </Button>
                            ))}
                        </div>
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
                {from}–{to} of {total}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 0}
                  aria-label="Previous page"
                >
                  <ChevronLeftIcon />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage((p) => p + 1)}
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

      <RoleChangeDialog change={change} onClose={() => setChange(null)} />
      <UserStatusDialog user={statusUser} onClose={() => setStatusUser(null)} />
    </div>
  );
}
