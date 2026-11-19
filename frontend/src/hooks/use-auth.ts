"use client";

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { broadcastAuth } from "@/lib/auth-sync";
import type { SessionUser, User } from "@/lib/types";

export const meQueryKey = ["auth", "me"] as const;

/** Drops cached data that belonged to the previous account (everything but the auth queries). */
export function clearAccountData(qc: QueryClient) {
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
}

/**
 * The signed-in user, shared app-wide through the React Query cache.
 * `data` is `null` when logged out (the API answered 401).
 */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async ({ signal }) => {
      try {
        return await api<SessionUser>("/auth/me", { signal });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    // Re-check on every return to the tab, even if fresh: another tab may have
    // logged in as someone else (a fallback for browsers without BroadcastChannel).
    refetchOnWindowFocus: "always",
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["auth", "login"],
    mutationFn: (body: { email: string; password: string }) =>
      api<{ user: SessionUser; expiresAt: string }>("/auth/login", { method: "POST", body }),
    onSuccess: ({ user }) => {
      clearAccountData(qc);
      qc.setQueryData(meQueryKey, user);
      broadcastAuth({ type: "login", userId: user.id });
    },
  });
}

export function useRegister() {
  return useMutation({
    mutationKey: ["auth", "register"],
    mutationFn: (body: { email: string; fullName: string; password: string }) =>
      api<User>("/users", { method: "POST", body }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["auth", "logout"],
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    // Even if the session had already expired server-side, drop everything
    // cached for this user and mark them logged out (the shell then redirects).
    onSettled: () => {
      clearAccountData(qc);
      qc.setQueryData(meQueryKey, null);
      broadcastAuth({ type: "logout" });
    },
  });
}
