"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Page, Role, User } from "@/lib/types";

export interface UsersFilter {
  role?: Role;
  search?: string;
  limit: number;
  offset: number;
}

/** Admin user list. Keeps the previous page on screen while the next one loads. */
export function useUsers(filter: UsersFilter, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["users", filter],
    queryFn: ({ signal }) => api<Page<User>>("/users", { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Roles an admin can assign: SUPERVISOR promotes an operator, OPERATOR demotes a supervisor. */
export type AssignableRole = "SUPERVISOR" | "OPERATOR";

export function useChangeRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AssignableRole }) =>
      api<User>(`/users/${encodeURIComponent(userId)}/role`, { method: "PATCH", body: { role } }),
    // Refresh on failure too: a 409 means someone else changed this user meanwhile.
    onSettled: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}
