"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { clearAccountData, meQueryKey } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { onAuthBroadcast } from "@/lib/auth-sync";
import type { SessionUser } from "@/lib/types";

function makeQueryClient() {
  /**
   * Any request answering 401 means the session ended (expired, revoked or
   * the user was deactivated). Marking the user as logged out makes the app
   * shell redirect to /login. Auth calls handle their own 401s.
   */
  const onError = (err: unknown, key: readonly unknown[] | undefined) => {
    if (!(err instanceof ApiError) || err.status !== 401 || key?.[0] === "auth") return;
    if (qc.getQueryData(meQueryKey)) toast.info("Your session has ended. Please log in again.");
    qc.setQueryData(meQueryKey, null);
  };

  const qc: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (err, query) => onError(err, query.queryKey) }),
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) => onError(err, mutation.options.mutationKey),
    }),
  });
  return qc;
}

/** Follows logins and logouts made in other tabs, which share this tab's session cookie. */
function useAuthSync(qc: QueryClient) {
  useEffect(
    () =>
      onAuthBroadcast((event) => {
        const current = qc.getQueryData<SessionUser | null>(meQueryKey);
        clearAccountData(qc);
        if (event.type === "logout") {
          // The app shell sees null and goes to /login.
          if (current) toast.info("You logged out in another tab.");
          qc.setQueryData(meQueryKey, null);
        } else {
          // Ask the server who we are now, rather than trusting the message.
          if (current && current.id !== event.userId) toast.info("You signed in as another account in another tab.");
          void qc.invalidateQueries({ queryKey: meQueryKey });
        }
      }),
    [qc],
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  useAuthSync(queryClient);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {children}
          <Toaster richColors position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
