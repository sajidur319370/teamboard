import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { app } from './setup/app';
import { validate, valid } from '../src/middleware/validate';
import { errorHandler, toAppError } from '../src/middleware/errorHandler';
import { httpLogger } from '../src/lib/httpLogger';
import { withTransaction } from '../src/db/transaction';
import { User } from '../src/db/models';
import { toUserDto } from '../src/modules/users/user.dto';

describe('backbone', () => {
  it('GET /health → 200 with an x-request-id header', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toMatch(/^req_/);
  });

  it('GET /ready → 200 when the database is connected', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
  });

  it('reuses an incoming x-request-id', async () => {
    const res = await request(app).get('/health').set('x-request-id', 'trace-123');
    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  it('unknown route → 404 in the standard error format', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Route not found.' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('malformed JSON → 400 INVALID_JSON', async () => {
    const res = await request(app)
      .post('/api/x')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('body over 100 kb → 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app)
      .post('/api/x')
      .send({ blob: 'x'.repeat(101 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects $-keys and dotted keys in the body, at any depth', async () => {
    for (const body of [{ email: { $ne: null } }, { a: [{ 'b.c': 1 }] }]) {
      const res = await request(app).post('/api/x').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_INPUT');
    }
  });

  it('sets security headers and hides x-powered-by', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('validate() parses and types the body', async () => {
    const schemas = { body: z.object({ n: z.number().int() }) };
    const mini = express()
      .use(express.json())
      .post('/x', validate(schemas), (req, res) => {
        res.json(valid(req, schemas).body);
      })
      .use(errorHandler);

    expect((await request(mini).post('/x').send({ n: 3 })).body).toEqual({ n: 3 });
    const bad = await request(mini).post('/x').send({ n: 'three' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(bad.body.error.details[0].field).toBe('n');
  });

  it('unexpected errors → generic 500 that does not leak the real message', async () => {
    const mini = express()
      .use(httpLogger)
      .get('/boom', () => {
        throw new Error('connection string mongodb://secret@host');
      })
      .use(errorHandler);

    const res = await request(mini).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong.',
    });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});

describe('database', () => {
  it('withTransaction rolls back when the callback throws', async () => {
    await expect(
      withTransaction(async (session) => {
        await User.create([{ email: 'a@test.dev', name: 'A', passwordHash: 'x' }], { session });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await User.countDocuments()).toBe(0);
  });

  it('withTransaction commits and returns the callback result', async () => {
    const id = await withTransaction(async (session) => {
      const [u] = await User.create([{ email: 'b@test.dev', name: 'B', passwordHash: 'x' }], {
        session,
      });
      return u!._id;
    });
    expect(await User.countDocuments({ _id: id })).toBe(1);
  });

  it('a duplicate email (E11000 on uniq_email) maps to 409 EMAIL_TAKEN', async () => {
    await User.create({ email: 'dup@test.dev', name: 'A', passwordHash: 'x' });
    const err = await User.create({ email: 'DUP@test.dev', name: 'B', passwordHash: 'x' }).catch(
      (e: unknown) => e,
    );
    expect(toAppError(err)).toMatchObject({ status: 409, code: 'EMAIL_TAKEN' });
  });

  it('passwordHash is hidden by default and never in the DTO', async () => {
    await User.create({ email: 'c@test.dev', name: 'C', passwordHash: 'hash' });
    const user = await User.findOne({ email: 'c@test.dev' }).lean();
    expect(user).not.toHaveProperty('passwordHash');

    const withHash = await User.findOne({ email: 'c@test.dev' }).select('+passwordHash').lean();
    expect(withHash?.passwordHash).toBe('hash');
    expect(toUserDto(withHash!)).toEqual({
      id: String(withHash!._id),
      email: 'c@test.dev',
      name: 'C',
      avatarColor: 'blue',
      timezone: 'UTC',
    });
  });
});
