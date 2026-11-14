import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLoginLimiter } from '../src/middleware/rateLimits';
import { errorHandler } from '../src/middleware/errorHandler';

// The limiters skip themselves under NODE_ENV=test; this builds an enabled one.
function app(limit: number) {
  const a = express();
  a.use(express.json());
  a.post('/login', createLoginLimiter(limit, true), (req, res) => {
    res.status(req.body.ok ? 200 : 401).json({});
  });
  a.use(errorHandler);
  return a;
}

describe('login rate limit (brute force)', () => {
  it('counts only FAILED logins: the (limit+1)th failure in the window is a 429', async () => {
    const a = app(3);
    for (let i = 0; i < 3; i++) await request(a).post('/login').send({ ok: false }).expect(401);
    const blocked = await request(a).post('/login').send({ ok: false });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('successful logins never use up the budget', async () => {
    const a = app(3);
    for (let i = 0; i < 20; i++) await request(a).post('/login').send({ ok: true }).expect(200);
    await request(a).post('/login').send({ ok: false }).expect(401); // still allowed
  });
});
