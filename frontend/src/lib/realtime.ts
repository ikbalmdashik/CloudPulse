import type { RequestEvent, ServiceRequest } from "./types";

/**
 * Where the backend's WebSocket (Socket.IO) server listens. Unlike REST calls,
 * the socket connects to the backend directly (Next rewrites don't carry
 * WebSockets). The session cookies still go along: cookies ignore ports, so
 * localhost:3000 and localhost:4000 share them.
 */
export const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000";

/** Server → client event names. Keep in sync with backend/src/realtime/realtime.service.ts. */
export const EVENTS = {
  requestChanged: "request.changed",
  sessionChanged: "session.changed",
} as const;

/** Reason the server gives (`connect_error`) when the access token is missing or expired. */
export const UNAUTHORIZED = "unauthorized";

export interface RequestChangedPayload {
  request: ServiceRequest;
  event: RequestEvent;
}
