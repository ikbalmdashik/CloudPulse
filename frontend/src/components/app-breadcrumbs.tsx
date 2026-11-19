"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useMe } from "@/hooks/use-auth";
import { useRequest } from "@/hooks/use-requests";
import type { Role } from "@/lib/types";

interface Crumb {
  /** Omitted for sections without a page of their own (e.g. Administration). */
  href?: string;
  label: React.ReactNode;
}

/** A request's code, from the same (cached) query the page uses. */
function RequestCode({ id }: { id: string }) {
  const { data } = useRequest(id);
  return <span className="font-mono">{data?.code ?? "Request"}</span>;
}

/** Breadcrumb trail for a path. Unknown paths fall back to Dashboard only. */
function crumbsFor(path: string, role: Role | undefined): Crumb[] {
  const home: Crumb = { href: "/", label: "Dashboard" };
  const requests: Crumb = { href: "/requests", label: role === "OPERATOR" ? "My requests" : "All requests" };
  const parts = path.split("/").filter(Boolean);

  if (parts[0] === "requests") {
    if (parts.length === 1) return [home, requests];
    if (parts[1] === "new") return [home, requests, { href: "/requests/new", label: "New request" }];
    return [home, requests, { href: path, label: <RequestCode id={parts[1]!} /> }];
  }
  if (parts[0] === "admin" && parts[1] === "users") return [home, { label: "Administration" }, { href: path, label: "Users" }];
  return [home];
}

/**
 * Where you are, and the way back. On phones only the last two steps show,
 * so the trail never wraps.
 */
export function AppBreadcrumbs() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const crumbs = crumbsFor(pathname, me?.role);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          const hideOnPhone = i < crumbs.length - 2 ? "hidden md:inline-flex" : undefined;
          return (
            <Fragment key={i}>
              {i > 0 && <BreadcrumbSeparator className={hideOnPhone} />}
              <BreadcrumbItem className={hideOnPhone}>
                {last ? (
                  <BreadcrumbPage>{c.label}</BreadcrumbPage>
                ) : c.href ? (
                  <BreadcrumbLink render={<Link href={c.href} />}>{c.label}</BreadcrumbLink>
                ) : (
                  <span>{c.label}</span>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
