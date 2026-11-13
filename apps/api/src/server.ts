import { createServer } from 'node:http';
import path from 'node:path';
import { createApp } from './app';
import { env, isProd } from './config/env';
import { connectDb } from './db/connection';
import { logger } from './lib/logger';
import { attachSocketServer } from './realtime/socket';

// In production one service serves the API AND the built React app (single origin).
// The bundle lives at apps/api/dist/server.js, so the web build is ../../web/dist.
const webDist = isProd ? path.resolve(import.meta.dirname, '../../web/dist') : undefined;

const app = createApp({ webDist });
const server = createServer(app);
attachSocketServer(server); // Socket.io shares the HTTP server: same origin, same port

await connectDb();
server.listen(env.PORT, () => {
  logger.info(
    `API listening on http://localhost:${env.PORT}${webDist ? ' (serving the web app)' : ''}`,
  );
});
