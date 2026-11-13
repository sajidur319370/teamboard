import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket } from 'socket.io-client';
import { createApp } from '../../src/app';
import { attachSocketServer } from '../../src/realtime/socket';

/** A real HTTP server with Socket.io on a random port (REST calls can still use supertest). */
export async function startServer() {
  const server = createServer(createApp());
  const io = attachSocketServer(server);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    close: () => new Promise<void>((r) => void io.close(() => r())),
  };
}

const open: Socket[] = [];

export function connect(port: number, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(`http://localhost:${port}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    open.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

/** Disconnect every socket a test opened (call in afterEach). */
export function disconnectAll() {
  for (const s of open.splice(0)) s.disconnect();
}

export const emitAck = <T = unknown>(s: Socket, event: string, payload: unknown) =>
  new Promise<T>((r) => s.emit(event, payload, r));

export function nextEvent<T = unknown>(s: Socket, event: string, ms = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    s.once(event, (p: T) => {
      clearTimeout(timer);
      resolve(p);
    });
  });
}

/** Records every event a socket receives, for "nothing leaked" assertions. */
export function record(s: Socket) {
  const seen: { event: string; payload: unknown }[] = [];
  s.onAny((event: string, payload: unknown) => seen.push({ event, payload }));
  return seen;
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
