import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import {
  objectIdSchema,
  rooms,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@teamboard/shared';
import { Membership, Project, Workspace } from '../db/models';
import { env, isProd } from '../config/env';
import { subscribe } from '../events/publish';
import { AppError } from '../lib/errors';
import { oid } from '../lib/ids';
import { logger } from '../lib/logger';
import { verifyAccessToken } from '../lib/tokens';
import { broadcast } from './broadcast';

export type IO = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

let io: IO | null = null;
let unsubscribe: (() => void) | null = null;
export const getIO = () => io;

const wsPayload = z.object({ workspaceId: objectIdSchema });
const boardPayload = z.object({ projectId: objectIdSchema });

/**
 * Socket.io on the SAME http server as the API (one origin in production).
 * Sockets only fan out results; every write goes through REST (FR-RT-05).
 */
export function attachSocketServer(httpServer: HttpServer): IO {
  const server: IO = new Server(httpServer, {
    serveClient: false,
    // Dev goes through the Vite proxy and prod is same-origin, so CORS is only a fallback.
    cors: isProd ? undefined : { origin: env.APP_URL, credentials: true },
  });
  io = server;

  // ---- handshake auth (FR-RT-01) ----
  server.use((socket, next) => {
    try {
      const { userId } = verifyAccessToken(String(socket.handshake.auth?.token ?? ''));
      socket.data.userId = userId;
      socket.data.workspaceId = null;
      next();
    } catch (err) {
      // The client sees err.message: UNAUTHENTICATED or TOKEN_EXPIRED → refresh and reconnect.
      next(new Error(err instanceof AppError ? err.code : 'UNAUTHENTICATED'));
    }
  });

  server.on('connection', (socket) => {
    const userId = oid(socket.data.userId);
    void socket.join(rooms.user(socket.data.userId)); // FR-RT-02

    // A client may omit the ack callback; never crash on that.
    const safe = (ack: unknown) =>
      typeof ack === 'function' ? (ack as (r: Ack) => void) : () => undefined;

    socket.on('workspace:join', async (payload, ack) => {
      const reply = safe(ack);
      try {
        const p = wsPayload.safeParse(payload);
        if (!p.success) return reply({ ok: false, code: 'VALIDATION_ERROR' });
        const workspaceId = oid(p.data.workspaceId);
        const [ws, member] = await Promise.all([
          Workspace.exists({ _id: workspaceId, deletedAt: null }),
          Membership.exists({ workspaceId, userId }),
        ]);
        if (!ws || !member) return reply({ ok: false, code: 'NOT_FOUND' }); // same answer for both

        // At most one workspace at a time (FR-RT-03): leave the previous workspace AND its boards.
        for (const room of socket.rooms) {
          if (room.startsWith('workspace:') || room.startsWith('board:')) void socket.leave(room);
        }
        void socket.join(rooms.workspace(String(workspaceId)));
        socket.data.workspaceId = String(workspaceId);
        reply({ ok: true });
      } catch (err) {
        logger.error({ err }, 'workspace:join failed');
        reply({ ok: false, code: 'INTERNAL_ERROR' });
      }
    });

    socket.on('board:join', async (payload, ack) => {
      const reply = safe(ack);
      try {
        const p = boardPayload.safeParse(payload);
        if (!p.success) return reply({ ok: false, code: 'VALIDATION_ERROR' });
        if (!socket.data.workspaceId) return reply({ ok: false, code: 'JOIN_WORKSPACE_FIRST' });
        const workspaceId = oid(socket.data.workspaceId);
        const [project, member] = await Promise.all([
          Project.exists({ _id: oid(p.data.projectId), workspaceId }), // tenant-scoped lookup
          Membership.exists({ workspaceId, userId }), // re-checked on EVERY join (E14, FR-RBAC-09)
        ]);
        if (!project || !member) return reply({ ok: false, code: 'NOT_FOUND' }); // AC-RT-02
        void socket.join(rooms.board(p.data.projectId));
        reply({ ok: true });
      } catch (err) {
        logger.error({ err }, 'board:join failed');
        reply({ ok: false, code: 'INTERNAL_ERROR' });
      }
    });

    socket.on('board:leave', (payload) => {
      const p = boardPayload.safeParse(payload);
      if (p.success) void socket.leave(rooms.board(p.data.projectId));
    });
    // Any other client event is simply ignored: there are no write handlers (FR-RT-05).
  });

  // Plug the broadcaster into the domain-event pipe (Day 6's design): every committed
  // write that publishes an event now fans out. Without a socket server nothing is sent.
  unsubscribe?.();
  unsubscribe = subscribe(broadcast);
  server.on('close', () => {
    unsubscribe?.();
    unsubscribe = null;
    if (io === server) io = null;
  });
  return server;
}
