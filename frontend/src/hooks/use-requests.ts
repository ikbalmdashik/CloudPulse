"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Category,
  Environment,
  Page,
  Priority,
  RequestDetail,
  ServiceRequest,
  Status,
} from "@/lib/types";

export interface RequestsFilter {
  status?: Status;
  category?: Category;
  priority?: Priority;
  search?: string;
  active?: boolean;
  limit: number;
  offset: number;
}

export const requestKeys = {
  all: ["requests"] as const,
  lists: () => ["requests", "list"] as const,
  list: (f: RequestsFilter) => ["requests", "list", f] as const,
  detail: (id: string) => ["requests", "detail", id] as const,
};

/**
 * Requests list. No polling: the realtime provider updates and refetches these
 * queries when the server pushes a change over the WebSocket.
 */
export function useRequests(filter: RequestsFilter) {
  return useQuery({
    queryKey: requestKeys.list(filter),
    queryFn: ({ signal }) =>
      api<Page<ServiceRequest>>("/requests", {
        query: { ...filter, active: filter.active ? "true" : undefined },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useRequest(id: string) {
  return useQuery({
    queryKey: requestKeys.detail(id),
    queryFn: ({ signal }) => api<RequestDetail>(`/requests/${encodeURIComponent(id)}`, { signal }),
  });
}

export interface NewRequestInput {
  title: string;
  description?: string;
  category: Category;
  priority: Priority;
  payload?: { environment: Environment; target: string };
}

export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    // One key per submission: if the network drops and the user retries the
    // same form, the server returns the first request instead of a duplicate.
    mutationFn: ({ input, idempotencyKey }: { input: NewRequestInput; idempotencyKey: string }) =>
      api<ServiceRequest>("/requests", {
        method: "POST",
        body: input,
        headers: { "idempotency-key": idempotencyKey },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: requestKeys.lists() }),
  });
}

export interface RequestUpdate {
  version: number;
  status?: Status;
  progress?: number;
  currentStep?: string | null;
  priority?: Priority;
  errorReason?: string;
  note?: string;
}

/** Applies a server response to the detail cache, keeping the loaded timeline. */
function useStoreRequest() {
  const qc = useQueryClient();
  return (updated: ServiceRequest) => {
    qc.setQueryData<RequestDetail>(requestKeys.detail(updated.id), (old) =>
      old && old.version <= updated.version ? { ...old, ...updated } : old,
    );
    void qc.invalidateQueries({ queryKey: requestKeys.all });
  };
}

export function useUpdateRequest(id: string) {
  const store = useStoreRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RequestUpdate) =>
      api<ServiceRequest>(`/requests/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    onSuccess: store,
    // On a conflict (someone else changed it), load the latest version.
    onError: () => qc.invalidateQueries({ queryKey: requestKeys.detail(id) }),
  });
}

export function useCancelRequest(id: string) {
  const store = useStoreRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { version: number; reason?: string }) =>
      api<ServiceRequest>(`/requests/${encodeURIComponent(id)}/cancel`, { method: "POST", body }),
    onSuccess: store,
    onError: () => qc.invalidateQueries({ queryKey: requestKeys.detail(id) }),
  });
}
