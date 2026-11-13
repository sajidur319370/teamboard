import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@teamboard/shared';
import { getAccessToken, refreshAccessToken } from '@/api/client';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;
let authRetries = 0;

/**
 * One socket per tab, same origin as the page (the Vite proxy in dev, Express in prod).
 * Created lazily, connected by the workspace layout, disconnected on logout.
 */
export function getSocket(): AppSocket {
  if (socket) return socket;

  const s: AppSocket = io({
    autoConnect: false,
    transports: ['websocket'],
    // A FUNCTION, so every (re)connect sends the CURRENT access token, not the one from page load.
    auth: (cb) => cb({ token: getAccessToken() }),
  });

  s.on('connect', () => {
    authRetries = 0;
  });

  // Middleware rejections (bad/expired token) are NOT retried by Socket.io itself, so refresh
  // the access token and reconnect once or twice. If refresh fails we're logged out: stop.
  s.on('connect_error', async (err) => {
    const authProblem = err.message === 'UNAUTHENTICATED' || err.message === 'TOKEN_EXPIRED';
    if (authProblem && authRetries++ < 2 && (await refreshAccessToken())) s.connect();
  });

  socket = s;
  return s;
}

/** Logout / session reset: close the socket. The next connect() uses the new token. */
export function disconnectSocket() {
  socket?.disconnect();
}
