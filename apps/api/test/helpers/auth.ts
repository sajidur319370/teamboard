import request from 'supertest';
import type { Response } from 'supertest';
import { app } from '../setup/app';

let n = 0;
export const PASSWORD = 'Passw0rd!';

/** Registers a fresh user and returns their access token. Reused every day from now on. */
export async function registerUser(name = `User ${++n}`) {
  const email = `user${++n}-${Date.now()}@test.dev`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name, email, password: PASSWORD });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return {
    token: res.body.accessToken as string,
    user: res.body.user as { id: string; name: string; email: string },
    email,
    cookie: refreshCookie(res),
  };
}

/** The `tb_refresh=<value>` pair from a response's Set-Cookie header. */
export function refreshCookie(res: Response): string {
  const raw = res.get('Set-Cookie') ?? [];
  const c = raw.find((x) => x.startsWith('tb_refresh='));
  if (!c) throw new Error('no refresh cookie');
  return c.split(';')[0]!;
}

/** Supertest with the Authorization header already set. */
export const as = (token: string) => ({
  get: (p: string) => request(app).get(p).set('Authorization', `Bearer ${token}`),
  post: (p: string) => request(app).post(p).set('Authorization', `Bearer ${token}`),
  patch: (p: string) => request(app).patch(p).set('Authorization', `Bearer ${token}`),
  put: (p: string) => request(app).put(p).set('Authorization', `Bearer ${token}`),
  delete: (p: string) => request(app).delete(p).set('Authorization', `Bearer ${token}`),
});
