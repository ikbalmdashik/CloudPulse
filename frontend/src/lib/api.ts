/** Error thrown for any non-2xx API response, carrying the backend's error body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** One message, or one per invalid field (`"email: must be a valid email address"`). */
    readonly messages: string[],
  ) {
    super(messages[0] ?? `Request failed with status ${status}`);
    this.name = "ApiError";
  }

  /**
   * Per-field messages from a 400, keyed by field name, so a form can show
   * each one under its input. Messages without a field go under `""`.
   */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of this.messages) {
      const match = /^([\w.]+): (.+)$/.exec(m);
      const [field, text] = match ? [match[1]!, match[2]!] : ["", m];
      out[field] ??= text;
    }
    return out;
  }
}

type Query = Record<string, string | number | undefined>;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/** Auth endpoints answer 401 for their own reasons (wrong password…); never retry them. */
const NO_REFRESH = ["/auth/login", "/auth/refresh", "/auth/logout"];

let refreshing: Promise<boolean> | null = null;

/**
 * Gets a new access token using the refresh cookie. Returns false if the
 * session is over (the user must log in again).
 *
 * Each refresh token works once, and all tabs share the cookies. A Web Lock
 * makes tabs take turns: a tab that waited first checks whether the tab before
 * it already refreshed (then the shared cookie works) and only refreshes if not.
 * Within one tab, concurrent callers share one attempt.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const run = async () => {
      const me = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (me.ok) return true;
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return res.ok;
    };
    try {
      return typeof navigator !== "undefined" && navigator.locks
        ? await navigator.locks.request("cloudpulse-refresh", run)
        : await run();
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * Calls the backend through the `/api` rewrite (see next.config.ts). The
 * access token (a short-lived JWT) and the refresh token travel in httpOnly
 * cookies, which the browser sends automatically; this code never sees them.
 * When the access token has expired, it refreshes once and retries.
 */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  try {
    return await send<T>(path, opts);
  } catch (err) {
    const retry =
      err instanceof ApiError && err.status === 401 && !NO_REFRESH.includes(path) && (await refreshSession());
    if (!retry) throw err;
    return await send<T>(path, opts);
  }
}

async function send<T>(path: string, opts: RequestOptions): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "") params.set(k, String(v));
  }
  const qs = params.size > 0 ? `?${params}` : "";

  let res: Response;
  try {
    res = await fetch(`/api${path}${qs}`, {
      method: opts.method ?? "GET",
      headers: {
        ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
        ...opts.headers,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, ["Can't reach the server. Check your connection and try again."]);
  }

  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = (data as { message?: string | string[] } | undefined)?.message;
    const messages = Array.isArray(message) ? message : message ? [message] : [];
    if (res.status >= 500 && messages.length === 0) messages.push("The server had a problem. Please try again.");
    throw new ApiError(res.status, messages);
  }
  return data as T;
}
