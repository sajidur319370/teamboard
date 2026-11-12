import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getAccessToken, http, setAccessToken } from './client';

type Handler = (path: string, init: RequestInit) => Response | Promise<Response>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const authHeader = (init: RequestInit) => new Headers(init.headers).get('Authorization');

let fetchMock: ReturnType<typeof vi.fn>;
let lockRequests: number;

function serve(handler: Handler) {
  fetchMock = vi.fn((url: string, init: RequestInit) => handler(url.replace(/^\/api/, ''), init));
  vi.stubGlobal('fetch', fetchMock);
}

const callsTo = (path: string) =>
  fetchMock.mock.calls.filter(([url]) => url === `/api${path}`).length;

beforeEach(() => {
  setAccessToken(null);
  lockRequests = 0;
  vi.stubGlobal('navigator', {
    locks: {
      request: (_name: string, fn: () => Promise<unknown>) => {
        lockRequests++;
        return fn();
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('sends the bearer token, JSON body and credentials', async () => {
    setAccessToken('tok');
    serve(() => json(200, { ok: true }));
    await http.post('/things', { a: 1 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/things');
    expect(authHeader(init)).toBe('Bearer tok');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
    expect(init.credentials).toBe('include');
  });

  it('three parallel 401s trigger ONE refresh, then all three retry with the new token', async () => {
    setAccessToken('expired');
    serve(async (path, init) => {
      if (path === '/auth/refresh') {
        await new Promise((r) => setTimeout(r, 20)); // keep the refresh in flight
        return json(200, { accessToken: 'fresh' });
      }
      return authHeader(init) === 'Bearer fresh'
        ? json(200, { path })
        : json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
    });

    const results = await Promise.all([http.get('/a'), http.get('/b'), http.get('/c')]);

    expect(results).toEqual([{ path: '/a' }, { path: '/b' }, { path: '/c' }]);
    expect(callsTo('/auth/refresh')).toBe(1);
    expect(lockRequests).toBe(1); // and it ran under the cross-tab Web Lock
    expect(getAccessToken()).toBe('fresh');
  });

  it('a failed refresh surfaces the original 401 and clears the token', async () => {
    setAccessToken('expired');
    serve((path) =>
      path === '/auth/refresh'
        ? json(401, { error: { code: 'SESSION_REVOKED', message: 'Please log in again.' } })
        : json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }),
    );

    await expect(http.get('/me')).rejects.toMatchObject({ status: 401, code: 'TOKEN_EXPIRED' });
    expect(getAccessToken()).toBeNull();
    expect(callsTo('/me')).toBe(1); // no retry after a failed refresh
  });

  it.each(['/auth/login', '/auth/register', '/auth/refresh', '/auth/reset-password'])(
    'a 401 from %s never triggers a refresh',
    async (path) => {
      serve(() =>
        json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }),
      );
      await expect(http.post(path, {})).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('/auth/logout-all DOES refresh on 401 (it needs a valid access token)', async () => {
    setAccessToken('expired');
    serve((path, init) => {
      if (path === '/auth/refresh') return json(200, { accessToken: 'fresh' });
      return authHeader(init) === 'Bearer fresh'
        ? new Response(null, { status: 204 })
        : json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
    });
    await expect(http.post('/auth/logout-all')).resolves.toBeUndefined();
  });

  it('turns the error envelope into an ApiError with code, message and details', async () => {
    const details = [{ field: 'password', issue: 'too_small', message: 'At least 8 characters' }];
    serve(() => json(400, { error: { code: 'VALIDATION_ERROR', message: 'Bad', details } }));

    const err = await http.post('/auth/register', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'Bad', details });
  });

  it('a non-JSON 502 from the proxy still becomes an ApiError', async () => {
    serve(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(http.get('/x')).rejects.toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
  });

  it('a network failure becomes ApiError NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(http.get('/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('works without Web Locks (insecure origin)', async () => {
    vi.stubGlobal('navigator', {});
    setAccessToken('expired');
    serve((path, init) => {
      if (path === '/auth/refresh') return json(200, { accessToken: 'fresh' });
      return authHeader(init) === 'Bearer fresh'
        ? json(200, { ok: true })
        : json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
    });
    await expect(http.get('/x')).resolves.toEqual({ ok: true });
  });
});
