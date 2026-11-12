// The one place the web app talks to the API.
// - The access token lives in memory only (FR-AUTH-14): XSS can't read it from storage.
// - On a 401 it refreshes ONCE (single-flight in this tab, Web Lock across tabs) and retries.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export type RequestOptions = RequestInit & { clientMutationId?: string };

/**
 * A 401 from these means "wrong credentials" or "no session", not "access token expired",
 * so refreshing would be pointless (and for /auth/refresh itself, an infinite loop).
 * /auth/logout-all is NOT here: it needs a valid access token, so it may refresh.
 */
const NO_REFRESH = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

async function send(path: string, init: RequestOptions): Promise<Response> {
  const { clientMutationId, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (clientMutationId) headers.set('X-Client-Mutation-Id', clientMutationId); // used on Day 15
  try {
    return await fetch(`/api${path}`, { ...rest, headers, credentials: 'include' });
  } catch {
    // fetch only rejects when the request never got an HTTP response (offline, DNS, CORS…).
    throw new ApiError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection.");
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string; details?: unknown };
  } | null;
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(
      res.status,
      e?.code ?? (res.status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
      e?.message ?? 'Request failed',
      e?.details,
    );
  }
  return data as T;
}

async function doRefresh(): Promise<boolean> {
  try {
    const res = await send('/auth/refresh', { method: 'POST' });
    if (!res.ok) {
      setAccessToken(null);
      return false;
    }
    const { accessToken: next } = (await res.json()) as { accessToken: string };
    setAccessToken(next);
    return true;
  } catch {
    return false; // network error: keep the current token, the caller sees the original error
  }
}

let refreshing: Promise<boolean> | null = null;

/**
 * One refresh at a time: single-flight in this tab AND a Web Lock across tabs.
 * Without the lock, two tabs could send the same refresh cookie at once, which the
 * server's reuse detection treats as theft (queries.md §3.3) and logs everyone out.
 */
export function refreshAccessToken(): Promise<boolean> {
  refreshing ??= (
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('teamboard-refresh', doRefresh)
      : doRefresh()
  ) // insecure origin (http on a LAN IP) or old browser: no Web Locks
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(path: string, init: RequestOptions = {}): Promise<T> {
  let res = await send(path, init);
  if (res.status === 401 && !NO_REFRESH.has(path)) {
    if (await refreshAccessToken()) res = await send(path, init); // retry once
  }
  return parse<T>(res);
}

const json = (b: unknown) => (b === undefined ? undefined : JSON.stringify(b));

export const http = {
  get: <T>(p: string, o?: RequestOptions) => api<T>(p, o),
  post: <T>(p: string, b?: unknown, o?: RequestOptions) =>
    api<T>(p, { ...o, method: 'POST', body: json(b ?? {}) }),
  patch: <T>(p: string, b: unknown, o?: RequestOptions) =>
    api<T>(p, { ...o, method: 'PATCH', body: json(b) }),
  put: <T>(p: string, b: unknown, o?: RequestOptions) =>
    api<T>(p, { ...o, method: 'PUT', body: json(b) }),
  delete: <T>(p: string, b?: unknown, o?: RequestOptions) =>
    api<T>(p, { ...o, method: 'DELETE', body: json(b) }),
};
