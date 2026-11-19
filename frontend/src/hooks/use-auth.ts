"use client";

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { broadcastAuth } from "@/lib/auth-sync";
import type { SessionUser, User } from "@/lib/types";

export const meQueryKey = ["auth", "me"] as const;
export const accountsQueryKey = ["auth", "accounts"] as const;

/** An account saved (signed in) in this browser. */
export interface SavedAccount extends SessionUser {
  /** The account in use right now: the most recently used one. */
  active: boolean;
}

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
    mutationFn: (body: { email: string; password: string; rememberMe: boolean }) =>
      api<{ user: SessionUser; expiresAt: string }>("/auth/login", { method: "POST", body }),
    onSuccess: ({ user }) => becomeUser(qc, user),
  });
}

/** After a login or switch: drop the previous account's data, then tell the other tabs. */
function becomeUser(qc: QueryClient, user: SessionUser) {
  clearAccountData(qc);
  qc.setQueryData(meQueryKey, user);
  void qc.invalidateQueries({ queryKey: accountsQueryKey });
  broadcastAuth({ type: "login", userId: user.id });
}

/**
 * Accounts saved in this browser, most recently used first. Each keeps its
 * own session, so switching needs no password.
 */
export function useSavedAccounts() {
  return useQuery({
    queryKey: accountsQueryKey,
    queryFn: ({ signal }) => api<SavedAccount[]>("/auth/accounts", { signal }),
    staleTime: 30_000,
  });
}

/** Make another saved account the active one (no password: its saved session is used). */
export function useSwitchAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["auth", "switch"],
    mutationFn: (userId: string) =>
      api<{ user: SessionUser }>("/auth/switch", { method: "POST", body: { userId } }),
    onSuccess: ({ user }) => becomeUser(qc, user),
    // A 401 means that account's session ended; the server dropped it, so refresh the list.
    onError: () => qc.invalidateQueries({ queryKey: accountsQueryKey }),
  });
}

/** Sign one saved account out of this browser. */
export function useForgetAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["auth", "forget"],
    mutationFn: (userId: string) =>
      api<void>(`/auth/accounts/${encodeURIComponent(userId)}/logout`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: accountsQueryKey }),
  });
}

/** Sign every saved account out of this browser. */
export function useLogoutAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["auth", "logout-all"],
    mutationFn: () => api<void>("/auth/logout-all", { method: "POST" }),
    onSettled: () => {
      clearAccountData(qc);
      qc.setQueryData(meQueryKey, null);
      qc.setQueryData(accountsQueryKey, []);
      broadcastAuth({ type: "logout" });
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
    // Signs out the active account only; other saved accounts stay signed in.
    // Even if the session had already expired server-side, drop everything
    // cached for this user and mark them logged out (the shell then redirects
    // to /login, where the remaining accounts are offered).
    onSettled: () => {
      clearAccountData(qc);
      qc.setQueryData(meQueryKey, null);
      void qc.invalidateQueries({ queryKey: accountsQueryKey });
      broadcastAuth({ type: "logout" });
    },
  });
}
