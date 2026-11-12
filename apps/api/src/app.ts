import express from 'express';
import mongoose from 'mongoose';

/** Builds the Express app without listening, so tests can import it. */
export function createApp() {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/ready', async (_req, res) => {
    try {
      const db = mongoose.connection.db;
      if (mongoose.connection.readyState !== 1 || !db) throw new Error('not connected');
      await db.admin().ping();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  return app;
}
