"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { AppSidebar } from "@/components/app-sidebar";
import { BackButton } from "@/components/back-button";
import { RealtimeProvider, useLiveStatus } from "@/components/realtime-provider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useMe } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

/** Shows whether live updates are flowing over the WebSocket. */
function LiveIndicator() {
  const status = useLiveStatus();
  const label = status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Reconnecting…";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      title={status === "live" ? "Updates appear instantly" : "Live updates paused; reconnecting"}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          status === "live" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-400" : "animate-pulse bg-destructive",
        )}
        aria-hidden
      />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

/**
 * Layout for signed-in pages: sidebar navigation, a top bar with breadcrumbs
 * and the live-updates indicator, then the page. Sends logged-out visitors to /login.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const me = useMe();

  useEffect(() => {
    if (me.data === null) router.replace("/login");
  }, [me.data, router]);

  return (
    <RealtimeProvider user={me.data}>
      <SidebarProvider>
        <AppSidebar user={me.data} />
        <SidebarInset>
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" aria-label="Toggle navigation" />
            <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
            <Suspense>
              <BackButton />
            </Suspense>
            <div className="min-w-0 flex-1">
              {/* Breadcrumbs read the URL, so they render inside Suspense. */}
              <Suspense fallback={<Skeleton className="h-4 w-40" />}>
                <AppBreadcrumbs />
              </Suspense>
            </div>
            {me.data && <LiveIndicator />}
          </header>

          <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:py-8">
            {me.isError ? (
              <div className="rounded-lg border border-destructive/40 p-6 text-sm">
                <p className="font-medium">Couldn&apos;t load your account.</p>
                <p className="mt-1 text-muted-foreground">{me.error.message}</p>
                <Button className="mt-4" variant="outline" size="sm" onClick={() => me.refetch()}>
                  Try again
                </Button>
              </div>
            ) : (
              // Always render the page so Next can prerender its shell; each page
              // shows its own loading state until the user is known.
              children
            )}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </RealtimeProvider>
  );
}
