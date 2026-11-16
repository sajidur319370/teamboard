import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { demoEmail, type DemoInfo } from '@teamboard/shared';
import { env } from '../src/config/env';
import { User, Workspace } from '../src/db/models';
import { demoIsStale, resetDemoIfStale } from '../src/demo/autoReset';
import { demoBuiltAt, resetDemo, seedDemo } from '../src/demo/seedDemo';
import { PASSWORD, as, registerUser } from './helpers/auth';
import { addMember, makeProject } from './helpers/tenants';
import { app } from './setup/app';

// DEMO_MODE: one-click logins, locked demo accounts, a protected demo workspace, auto reset.
beforeEach(() => {
  env.DEMO_MODE = true;
});
afterEach(() => {
  env.DEMO_MODE = false;
});

async function registerAs(email: string, name: string) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name, email, password: PASSWORD });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return { token: res.body.accessToken as string, user: res.body.user as { id: string } };
}

describe('one-click demo login', () => {
  it('GET /api/auth/demo says whether the buttons show, and for which accounts', async () => {
    const on = (await request(app).get('/api/auth/demo').expect(200)).body as DemoInfo;
    expect(on.enabled).toBe(true);
    expect(on.accounts.map((a) => a.email)).toEqual([
      'owner@demo.teamboard.dev',
      'admin@demo.teamboard.dev',
      'member@demo.teamboard.dev',
      'viewer@demo.teamboard.dev',
    ]);
    env.DEMO_MODE = false;
    expect((await request(app).get('/api/auth/demo')).body).toEqual({
      enabled: false,
      accounts: [],
      resetHours: null,
    });
  });

  it('POST /api/auth/demo logs in as that role, with no password, and sets the refresh cookie', async () => {
    await registerAs(demoEmail('viewer'), 'Victor Viewer');
    const res = await request(app).post('/api/auth/demo').send({ role: 'viewer' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'viewer@demo.teamboard.dev' });
    expect(String(res.headers['set-cookie'])).toMatch(/tb_refresh=.*HttpOnly/);
    await as(res.body.accessToken).get('/api/me').expect(200);
  });

  it('only in demo mode (404 otherwise); a bad role is 400; mid-reset is a clear 503', async () => {
    expect((await request(app).post('/api/auth/demo').send({ role: 'root' })).status).toBe(400);
    const missing = await request(app).post('/api/auth/demo').send({ role: 'owner' });
    expect([missing.status, missing.body.error.code]).toEqual([503, 'DEMO_NOT_READY']);
    env.DEMO_MODE = false;
    expect((await request(app).post('/api/auth/demo').send({ role: 'owner' })).status).toBe(404);
  });
});

describe('demo accounts are locked (shared by every visitor)', () => {
  it('no password change, no profile edits, no "log out everywhere"', async () => {
    const demo = await registerAs(demoEmail('member'), 'Mina Member');
    const tries = [
      await as(demo.token)
        .patch('/api/me/password')
        .send({ currentPassword: PASSWORD, newPassword: 'Hijacked123!' }),
      await as(demo.token).patch('/api/me').send({ name: 'pwned' }),
      await as(demo.token).post('/api/auth/logout-all'),
    ];
    expect(tries.map((r) => [r.status, r.body.error?.code])).toEqual(
      Array(3).fill([403, 'DEMO_ACCOUNT']),
    );
    // The password still works
    await request(app)
      .post('/api/auth/login')
      .send({ email: demoEmail('member'), password: PASSWORD })
      .expect(200);
  });

  it('real accounts are unaffected; outside demo mode demo accounts are normal', async () => {
    const real = await registerUser('Real Person');
    await as(real.token).patch('/api/me').send({ name: 'Renamed' }).expect(200);
    const demo = await registerAs(demoEmail('admin'), 'Arif Admin');
    env.DEMO_MODE = false;
    await as(demo.token).patch('/api/me').send({ name: 'Renamed' }).expect(200);
  });
});

describe('the demo workspace is protected', () => {
  /** Built with demo mode OFF (it adds a member through an invite), then switched on. */
  async function demoWorkspace() {
    env.DEMO_MODE = false;
    const owner = await registerAs(demoEmail('owner'), 'Olivia Owner');
    const res = await as(owner.token).post('/api/workspaces').send({ name: 'Acme', slug: 'acme' });
    expect(res.status).toBe(201);
    const ws = res.body.workspace;
    const member = await addMember(owner.token, ws, 'member', 'Mina');
    await makeProject(owner.token, ws, 'MOB');
    env.DEMO_MODE = true;
    return { owner, ws, member };
  }

  it('blocks what would break it for the next visitor', async () => {
    const { owner, member } = await demoWorkspace();
    const w = '/api/w/acme';
    const o = as(owner.token);
    const tries = [
      await o.patch(w).send({ name: 'pwned' }),
      await o.delete(w).send({ confirmName: 'Acme' }),
      await o.post(`${w}/transfer-ownership`).send({ userId: member.user.id, password: PASSWORD }),
      await o.patch(`${w}/members/${member.user.id}`).send({ role: 'viewer' }),
      await o.delete(`${w}/members/${member.user.id}`),
      await o.post(`${w}/invites`).send({ role: 'viewer' }),
      await o.delete(`${w}/projects/MOB`).send({ confirmKey: 'MOB' }),
      await o.post(`${w}/projects/MOB/archive`),
      await as(member.token).post(`${w}/leave`),
    ];
    expect(tries.map((r) => [r.status, r.body.error?.code])).toEqual(
      Array(tries.length).fill([403, 'DEMO_PROTECTED']),
    );
    expect(await Workspace.exists({ slug: 'acme', deletedAt: null })).not.toBeNull();
  });

  it('everyday work stays open: tasks, moves, comments, new projects', async () => {
    const { owner, member } = await demoWorkspace();
    const w = '/api/w/acme';
    const task = await as(member.token).post(`${w}/projects/MOB/tasks`).send({ title: 'Try me' });
    expect(task.status).toBe(201);
    await as(member.token)
      .post(`${w}/tasks/${task.body.task.id}/comments`)
      .send({ body: 'Hello' })
      .expect(201);
    await as(owner.token).post(`${w}/projects`).send({ name: 'Mine', key: 'MIN' }).expect(201);
  });

  it('other workspaces, and demo mode off, are not affected', async () => {
    const real = await registerUser('Real Owner');
    const own = await as(real.token)
      .post('/api/workspaces')
      .send({ name: 'Mine', slug: 'mine-ws' });
    await as(real.token)
      .patch(`/api/w/${own.body.workspace.slug}`)
      .send({ name: 'Renamed' })
      .expect(200);

    const { owner } = await demoWorkspace();
    env.DEMO_MODE = false;
    await as(owner.token).patch('/api/w/acme').send({ name: 'Renamed' }).expect(200);
  });
});

describe('seed + automatic reset', () => {
  it('seeds the demo, rebuilds it once it is a day old, and never touches a real workspace', async () => {
    const counts = await seedDemo({ password: PASSWORD });
    expect(counts.tasks).toBe(58);
    expect(counts.activities).toBeGreaterThan(150);
    const firstOwner = await User.findOne({ email: demoEmail('owner') }).lean();

    const builtAt = (await demoBuiltAt())!;
    expect(await demoIsStale(new Date(builtAt.getTime() + 23 * 3_600_000), 24)).toBe(false);
    expect(await demoIsStale(new Date(builtAt.getTime() + 25 * 3_600_000), 24)).toBe(true);

    // Not stale now: nothing happens
    expect(await resetDemoIfStale(new Date())).toBe(false);

    // A day later: two checks at once → ONE rebuild
    const later = new Date(builtAt.getTime() + 25 * 3_600_000);
    const [a, b] = await Promise.all([resetDemoIfStale(later), resetDemoIfStale(later)]);
    expect([a, b]).toEqual([true, true]); // the second waited for the first
    expect(await Workspace.countDocuments({ slug: 'acme' })).toBe(1);
    const newOwner = await User.findOne({ email: demoEmail('owner') }).lean();
    expect(String(newOwner!._id)).not.toBe(String(firstOwner!._id)); // rebuilt from scratch
    // ...and the demo login works with the configured password
    await request(app)
      .post('/api/auth/login')
      .send({ email: demoEmail('owner'), password: env.SEED_DEMO_PASSWORD })
      .expect(200);
  }, 120_000);

  it('refuses to reset if /w/acme belongs to a real (non-demo) owner', async () => {
    const real = await registerUser('Squatter');
    await as(real.token).post('/api/workspaces').send({ name: 'Acme', slug: 'acme' }).expect(201);
    await expect(resetDemo()).rejects.toThrow(/real \(non-demo\) owner/);
    expect(await Workspace.exists({ slug: 'acme' })).not.toBeNull();
  });
});

describe('a demo login during a reset', () => {
  it('waits for the fresh demo instead of failing', async () => {
    await seedDemo({ password: PASSWORD });
    const builtAt = (await demoBuiltAt())!;
    const reset = resetDemoIfStale(new Date(builtAt.getTime() + 25 * 3_600_000)); // starts
    const login = await request(app).post('/api/auth/demo').send({ role: 'member' });
    expect(login.status).toBe(200); // not 503: it waited
    expect(await reset).toBe(true);
    const fresh = await User.findOne({ email: demoEmail('member') }).lean();
    expect(login.body.user.id).toBe(String(fresh!._id)); // a session on the REBUILT user
  }, 120_000);
});
