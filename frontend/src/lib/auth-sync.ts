/**
 * Keeps open tabs in step with each other. All tabs share one session cookie,
 * so a login or logout in one tab changes who every other tab is acting as.
 * Without this, another tab would keep showing the old account while its
 * requests ran as the new one.
 */
const CHANNEL = "cloudpulse-auth";

export type AuthEvent = { type: "login"; userId: string } | { type: "logout" };

export function broadcastAuth(event: AuthEvent): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(event);
  channel.close();
}

/** Calls `listener` for events from *other* tabs (a tab doesn't receive its own). Returns an unsubscribe function. */
export function onAuthBroadcast(listener: (event: AuthEvent) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent<AuthEvent>) => listener(e.data);
  return () => channel.close();
}
