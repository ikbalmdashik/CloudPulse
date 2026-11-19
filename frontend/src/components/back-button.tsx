"use client";

import { ArrowLeftIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { crumbsFor } from "@/components/app-breadcrumbs";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMe } from "@/hooks/use-auth";

/**
 * Pages visited inside the app since it loaded. When there is one to go back
 * to, Back returns there (keeping that page's filters and scroll); on a page
 * opened directly (a shared link, a refresh) it goes up to the parent page.
 */
let firstPath: string | null = null;
let movedInApp = false;

/**
 * The top bar's Back button: everywhere except the dashboard, which is the
 * top of the app. Its label names the page it leads to. Rendered once, in the
 * app shell's top bar, so it also counts the app's page changes. It reads the
 * URL, so it renders inside Suspense.
 */
export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me } = useMe();
  // Compares paths rather than counting renders: effects can run twice for one page.
  useEffect(() => {
    if (firstPath === null) firstPath = pathname;
    else if (pathname !== firstPath) movedInApp = true;
  }, [pathname]);
  const crumbs = crumbsFor(pathname, me?.role);
  const parent = crumbs.slice(0, -1).findLast((c) => c.href);
  if (pathname === "/" || !parent?.href) return null;

  const label = typeof parent.label === "string" ? parent.label : "previous page";
  const goBack = () => {
    if (movedInApp) router.back();
    else router.push(parent.href!);
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="sm" onClick={goBack} aria-label={`Back to ${label}`} className="-ml-1 gap-1 px-2" />
        }
      >
        <ArrowLeftIcon />
        <span className="hidden sm:inline">Back</span>
      </TooltipTrigger>
      <TooltipContent>Back to {label}</TooltipContent>
    </Tooltip>
  );
}
