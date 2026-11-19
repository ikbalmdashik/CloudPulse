"use client";

import { ArrowRightIcon, CheckIcon, EyeIcon, PencilIcon, SendIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { RoleBadge } from "@/components/role-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/use-auth";
import type { Role } from "@/lib/types";

const ABILITIES: Record<Role, { icon: React.ComponentType<{ className?: string }>; text: string }[]> = {
  OPERATOR: [
    { icon: SendIcon, text: "Submit service requests: VM provisioning, health checks, config updates, audits and access resets" },
    { icon: EyeIcon, text: "Follow your requests' progress live" },
  ],
  SUPERVISOR: [
    { icon: EyeIcon, text: "Monitor every request as it is processed, in real time" },
    { icon: PencilIcon, text: "Move requests along: start, update progress, complete, fail or cancel" },
    { icon: SendIcon, text: "Submit service requests" },
  ],
  ADMIN: [
    { icon: ShieldCheckIcon, text: "Manage users: promote operators to supervisors, or demote them" },
    { icon: PencilIcon, text: "Monitor and manage every request in real time" },
  ],
};

export function Dashboard() {
  const { data: user } = useMe();
  if (!user) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      </div>
    );
  }
  const firstName = user.fullName.split(/\s+/)[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {firstName}</h1>
        <RoleBadge role={user.role} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>What you can do</CardTitle>
            <CardDescription>Based on your role.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm">
              {ABILITIES[user.role].map(({ icon: Icon, text }) => (
                <li key={text} className="flex gap-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/requests/new" className={buttonVariants({ size: "sm" })}>
                New request
              </Link>
              <Link href="/requests" className={buttonVariants({ size: "sm", variant: "outline" })}>
                {user.role === "OPERATOR" ? "My requests" : "All requests"} <ArrowRightIcon />
              </Link>
            </div>
          </CardContent>
        </Card>

        {user.role === "ADMIN" ? (
          <Card>
            <CardHeader>
              <CardTitle>User management</CardTitle>
              <CardDescription>New accounts start as operators.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Review who has signed up and promote trusted operators to supervisor so they can
                monitor all requests.
              </p>
              <Link href="/admin/users" className={buttonVariants()}>
                Manage users <ArrowRightIcon />
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Your account</CardTitle>
              <CardDescription>{user.email}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p className="flex gap-2">
                <CheckIcon className="mt-0.5 size-4 shrink-0" />
                Signed in as {user.role === "OPERATOR" ? "an operator" : "a supervisor"}.
              </p>
              {user.role === "OPERATOR" && (
                <p>Need to monitor all requests? Ask an admin to promote you to supervisor.</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
