"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { meQueryKey } from "@/hooks/use-auth";
import { requestKeys } from "@/hooks/use-requests";
import { refreshSession } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/labels";
import { EVENTS, REALTIME_URL, type RequestChangedPayload, UNAUTHORIZED } from "@/lib/realtime";
import type { Page, RequestDetail, ServiceRequest, SessionUser } from "@/lib/types";

export type LiveStatus = "connecting" | "live" | "offline";

const LiveStatusContext = createContext<LiveStatus>("connecting");

/** Whether live updates are flowing, for the indicator in the header. */
export const useLiveStatus = () => useContext(LiveStatusContext);

/** Merges a pushed change into every cached copy of that request. */
function applyRequestChange(qc: QueryClient, { request, event }: RequestChangedPayload) {
  // Detail page: newer version wins; append the event to the timeline once.
  qc.setQueryData<RequestDetail>(requestKeys.detail(request.id), (old) => {
    if (!old || old.version > request.version) return old;
    const events = old.events.some((e) => e.id === event.id) ? old.events : [...old.events, event];
    return { ...old, ...request, events };
  });
  // Lists: update the row in place right away…
  qc.setQueriesData<Page<ServiceRequest>>({ queryKey: requestKeys.lists() }, (old) =>
    old && {
      ...old,
      items: old.items.map((r) => (r.id === request.id && r.version <= request.version ? request : r)),
    },
  );
  // …then refetch them, since a new or changed request can enter or leave a filtered page.
  void qc.invalidateQueries({ queryKey: requestKeys.lists() });
}

/**
 * Opens the WebSocket once the user is known and keeps the React Query cache
 * in step with what the server pushes. This replaces polling: screens update
 * the moment a request is created or changed by anyone.
 */
export function RealtimeProvider({ user, children }: { user?: SessionUser | null; children: React.ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("connecting");

  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    const socket: Socket = io(REALTIME_URL, {
      withCredentials: true, // send the access-token cookie with the handshake
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      setStatus("live");
      // Anything pushed while we were disconnected was missed: catch up once.
      void qc.invalidateQueries({ queryKey: requestKeys.all });
    });
    socket.on("disconnect", (reason) => {
      setStatus("offline");
      // The server drops sockets when the access token expires or the role
      // changes; renew the token and come back.
      if (reason === "io server disconnect") {
        void refreshSession().then((ok) => (ok ? socket.connect() : qc.setQueryData(meQueryKey, null)));
      }
    });
    socket.on("connect_error", (err) => {
      setStatus("offline");
      if (err.message === UNAUTHORIZED) {
        void refreshSession().then((ok) => (ok ? socket.connect() : qc.setQueryData(meQueryKey, null)));
      }
      // Other errors (server down…): Socket.IO retries on its own with backoff.
    });

    socket.on(EVENTS.requestChanged, (payload: RequestChangedPayload) => {
      applyRequestChange(qc, payload);
      const { request, event } = payload;
      // Tell operators when someone else moves their request along.
      if (request.operatorId === userId && event.actor?.id !== userId && event.toStatus) {
        toast.info(`${request.code} is now ${STATUS_LABEL[event.toStatus].toLowerCase()}`, {
          description: request.title,
        });
      }
    });

    socket.on(EVENTS.sessionChanged, () => {
      // Our role changed: re-read who we are; the server reconnects us with the new role.
      void refreshSession().then(() => {
        void qc.invalidateQueries({ queryKey: meQueryKey });
        void qc.invalidateQueries({ queryKey: requestKeys.all });
        toast.info("Your role has changed.");
      });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [qc, userId]);

  return <LiveStatusContext value={status}>{children}</LiveStatusContext>;
}
