import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './setup/app';
import { PASSWORD, as, refreshCookie, registerUser } from './helpers/auth';
import { Session, User } from '../src/db/models';
import { sha256 } from '../src/lib/crypto';

const SECRET = 'test-secret-test-secret-test-secret-123'; // matches vitest.config.ts

const register = (agent: ReturnType<typeof request.agent>, email: string) =>
  agent.post('/api/auth/register').send({ name: 'A', email, password: PASSWORD });

describe('register & login', () => {
  it('register → /me works with the access token', async () => {
    const { token, email } = await registerUser('Rahim');
    const me = await as(token).get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ name: 'Rahim', email });
    expect(me.body.workspaces).toEqual([]);
  });

  it('sets the refresh cookie as HttpOnly, SameSite=Lax, scoped to /api/auth', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'cookie@test.dev', password: PASSWORD });
    const raw = (res.get('Set-Cookie') ?? []).find((c) => c.startsWith('tb_refresh='))!;
    expect(raw).toMatch(/Path=\/api\/auth/);
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Lax/);
    expect(raw).toMatch(/Max-Age=604800/); // 7 days
  });

  it('stores the email lowercased and trimmed', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: '  MiXeD@Test.Dev ', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('mixed@test.dev');
  });

  it('duplicate email in any letter case → 409 EMAIL_TAKEN (AC-AUTH-01)', async () => {
    const { email } = await registerUser();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'X', email: email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('login with the right password → 200 with a token and cookie', async () => {
    const { email } = await registerUser();
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookie(res)).toMatch(/^tb_refresh=/);
  });

  it('wrong password and unknown email give the same error (FR-AUTH-03)', async () => {
    const { email } = await registerUser();
    const a = await request(app).post('/api/auth/login').send({ email, password: 'Wrong1234' });
    const b = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.dev', password: 'Wrong1234' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    expect(a.body.error).toMatchObject({ code: b.body.error.code, message: b.body.error.message });
  });

  it('weak password → 400 with field details', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'w@test.dev', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('password');
  });
});

describe('access token', () => {
  it('missing, garbage or tampered token → 401 UNAUTHENTICATED', async () => {
    const { token } = await registerUser();
    const i = token.length - 5; // a character inside the signature
    const tampered = token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1);
    // `token` without "Bearer " also fails: the scheme is required.
    for (const header of [undefined, 'Bearer garbage', `Bearer ${tampered}`, token]) {
      const req = request(app).get('/api/me');
      const res = header ? await req.set('Authorization', header) : await req;
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('expired token → 401 TOKEN_EXPIRED', async () => {
    const expired = jwt.sign({ sid: String(new Types.ObjectId()) }, SECRET, {
      subject: String(new Types.ObjectId()),
      expiresIn: -10,
    });
    const res = await as(expired).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const none = jwt.sign({ sid: String(new Types.ObjectId()) }, null, {
      subject: String(new Types.ObjectId()),
      algorithm: 'none',
    });
    expect((await as(none).get('/api/me')).status).toBe(401);
  });

  it('a valid signature with a non-ObjectId subject → 401, not 500', async () => {
    const odd = jwt.sign({ sid: 'not-an-id' }, SECRET, { subject: 'not-an-id', expiresIn: 60 });
    expect((await as(odd).get('/api/me')).status).toBe(401);
  });

  it('carries only sub and sid (no role, no workspace)', async () => {
    const { token } = await registerUser();
    const claims = jwt.decode(token) as Record<string, unknown>;
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'sid', 'sub']);
  });
});

describe('refresh rotation', () => {
  it('rotates the token; replaying the old one revokes the family (AC-AUTH-03)', async () => {
    const agent = request.agent(app);
    const oldCookie = refreshCookie(await register(agent, 'rot@test.dev'));

    const r1 = await agent.post('/api/auth/refresh'); // agent now holds the NEW cookie
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookie(r1)).not.toBe(oldCookie);

    const replay = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_REVOKED');

    const r2 = await agent.post('/api/auth/refresh'); // the new session died too
    expect(r2.status).toBe(401);
  });

  it('no cookie → 401', async () => {
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
  });

  it('two parallel refreshes with the same token → exactly one succeeds', async () => {
    const { cookie } = await registerUser();
    const results = await Promise.all(
      [1, 2].map(() => request(app).post('/api/auth/refresh').set('Cookie', cookie)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('an expired session → 401 TOKEN_EXPIRED', async () => {
    const { cookie } = await registerUser();
    const tokenHash = sha256(cookie.slice('tb_refresh='.length));
    await Session.updateOne({ tokenHash }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('logout', () => {
  it('logout revokes the refresh token and clears the cookie', async () => {
    const agent = request.agent(app);
    await register(agent, 'out@test.dev');
    const res = await agent.post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect((res.get('Set-Cookie') ?? []).join()).toMatch(/tb_refresh=;/);
    expect((await agent.post('/api/auth/refresh')).status).toBe(401);
  });

  it('logout-all revokes every device of the user', async () => {
    const phone = request.agent(app);
    const laptop = request.agent(app);
    const reg = await register(phone, 'all@test.dev');
    await laptop.post('/api/auth/login').send({ email: 'all@test.dev', password: PASSWORD });

    const res = await phone
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(res.status).toBe(204);
    expect((await phone.post('/api/auth/refresh')).status).toBe(401);
    expect((await laptop.post('/api/auth/refresh')).status).toBe(401);
  });
});

describe('password reset', () => {
  const plantToken = (email: string, token: string, msFromNow: number) =>
    User.updateOne(
      { email },
      {
        $set: {
          passwordResetTokenHash: sha256(token),
          passwordResetExpiresAt: new Date(Date.now() + msFromNow),
        },
      },
    );

  it('forgot always 200; reset works once and kills old sessions (AC-AUTH-04)', async () => {
    const agent = request.agent(app);
    await register(agent, 'reset@test.dev');

    for (const email of ['nobody@test.dev', 'reset@test.dev']) {
      const res = await request(app).post('/api/auth/forgot-password').send({ email });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }

    // Plant a known token instead of reading the console.
    await plantToken('reset@test.dev', 'known-token-known-token', 60_000);
    const body = { token: 'known-token-known-token', password: 'NewPassw0rd' };
    expect((await request(app).post('/api/auth/reset-password').send(body)).status).toBe(200);
    const again = await request(app).post('/api/auth/reset-password').send(body); // single use
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect((await agent.post('/api/auth/refresh')).status).toBe(401); // old session revoked

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset@test.dev', password: 'NewPassw0rd' });
    expect(login.status).toBe(200);
  });

  it('an expired reset token → 400', async () => {
    await registerUser();
    const { email } = await registerUser();
    await plantToken(email, 'expired-token-expired-token', -1000);
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'expired-token-expired-token', password: 'NewPassw0rd' });
    expect(res.status).toBe(400);
  });
});

describe('/me', () => {
  it('PATCH updates the profile and ignores fields that are not allowed', async () => {
    const { token, email } = await registerUser();
    const res = await as(token)
      .patch('/api/me')
      .send({ name: 'New Name', timezone: 'Asia/Dhaka', avatarColor: 'teal', email: 'x@evil.dev' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      name: 'New Name',
      timezone: 'Asia/Dhaka',
      avatarColor: 'teal',
      email,
    });
  });

  it('PATCH rejects an unknown timezone and a color outside the palette', async () => {
    const { token } = await registerUser();
    for (const body of [{ timezone: 'Mars/Olympus' }, { avatarColor: 'neon' }]) {
      expect((await as(token).patch('/api/me').send(body)).status).toBe(400);
    }
  });

  it('change password needs the current one, then revokes OTHER sessions only', async () => {
    const here = request.agent(app);
    const other = request.agent(app);
    const reg = await register(here, 'chpw@test.dev');
    await other.post('/api/auth/login').send({ email: 'chpw@test.dev', password: PASSWORD });
    const token = reg.body.accessToken as string;

    const wrong = await as(token)
      .patch('/api/me/password')
      .send({ currentPassword: 'Wrong1234', newPassword: 'NewPassw0rd' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('WRONG_PASSWORD');

    const ok = await as(token)
      .patch('/api/me/password')
      .send({ currentPassword: PASSWORD, newPassword: 'NewPassw0rd' });
    expect(ok.status).toBe(200);

    expect((await here.post('/api/auth/refresh')).status).toBe(200); // this device stays in
    expect((await other.post('/api/auth/refresh')).status).toBe(401); // the other is out
  });

  it('never leaks hashes or tokens in responses (AC-AUTH-05)', async () => {
    const { token } = await registerUser();
    const me = await as(token).get('/api/me');
    const json = JSON.stringify(me.body);
    expect(json).not.toContain('passwordHash');
    expect(json).not.toContain('tokenHash');
    expect(json).not.toMatch(/\$2[aby]\$/); // bcrypt prefix
  });
});
