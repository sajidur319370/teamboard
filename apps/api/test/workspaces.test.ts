import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '@teamboard/shared';
import { Activity, Membership, Workspace } from '../src/db/models';
import { as, registerUser } from './helpers/auth';
import { addMember, fourRoles, makeWorkspace } from './helpers/tenants';

const oid = (id: string) => new Types.ObjectId(id);

describe('create workspace', () => {
  it('201; the creator is owner in GET /me, and it was written atomically', async () => {
    const { token, user } = await registerUser();
    const res = await as(token).post('/api/workspaces').send({ name: 'Acme Studio', slug: 'acme' });
    expect(res.status).toBe(201);
    expect(res.body.workspace).toMatchObject({
      name: 'Acme Studio',
      slug: 'acme',
      ownerId: user.id,
      settings: { timezone: 'UTC', weekStartsOn: 1, workingDays: [1, 2, 3, 4, 5] },
    });

    const me = await as(token).get('/api/me');
    expect(me.body.workspaces).toEqual([
      { id: res.body.workspace.id, name: 'Acme Studio', slug: 'acme', role: 'owner' },
    ]);

    const workspaceId = oid(res.body.workspace.id);
    expect(await Membership.countDocuments({ workspaceId, role: 'owner' })).toBe(1);
    const acts = await Activity.find({ workspaceId }).lean();
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ action: 'workspace.created', entityType: 'workspace' });
  });

  it("uses the creator's timezone as the default (FR-WS-06)", async () => {
    const { token } = await registerUser();
    await as(token).patch('/api/me').send({ timezone: 'Asia/Dhaka' });
    const ws = await makeWorkspace(token);
    expect(ws.settings.timezone).toBe('Asia/Dhaka');
  });

  it('same slug twice → 409 SLUG_TAKEN, and nothing half-written remains', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await as(a.token).post('/api/workspaces').send({ name: 'One', slug: 'taken' });
    const res = await as(b.token).post('/api/workspaces').send({ name: 'Two', slug: 'taken' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLUG_TAKEN');
    // The transaction rolled back: b owns nothing.
    expect((await as(b.token).get('/api/me')).body.workspaces).toEqual([]);
  });

  it('reserved slug → 400 with issue SLUG_RESERVED (AC-WS-03)', async () => {
    const { token } = await registerUser();
    for (const slug of ['api', 'admin', 'signup']) {
      const res = await as(token).post('/api/workspaces').send({ name: 'X Co', slug });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0]).toMatchObject({ field: 'slug', issue: 'SLUG_RESERVED' });
    }
  });

  it('badly formed slugs and names → 400', async () => {
    const { token } = await registerUser();
    for (const body of [
      { name: 'Ok name', slug: '-acme' },
      { name: 'Ok name', slug: 'ac' },
      { name: 'Ok name', slug: 'has space' },
      { name: 'A', slug: 'fine-slug' },
    ]) {
      expect((await as(token).post('/api/workspaces').send(body)).status).toBe(400);
    }
  });

  it(`owning ${LIMITS.workspacesPerUser} workspaces → 409 WORKSPACE_LIMIT`, async () => {
    const { token } = await registerUser();
    for (let i = 0; i < LIMITS.workspacesPerUser; i++) await makeWorkspace(token, `Corp ${i}`);
    const res = await as(token)
      .post('/api/workspaces')
      .send({ name: 'One more', slug: 'one-more' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('WORKSPACE_LIMIT');
  });

  it('requires login', async () => {
    const res = await as('not-a-token').post('/api/workspaces').send({ name: 'X Co', slug: 'xco' });
    expect(res.status).toBe(401);
  });
});

describe('check-slug', () => {
  it('reports taken, free, reserved and invalid slugs', async () => {
    const { token } = await registerUser();
    await makeWorkspace(token).then((ws) =>
      Workspace.updateOne({ _id: oid(ws.id) }, { $set: { slug: 'taken-one' } }),
    );
    const check = async (slug: string) =>
      (await as(token).get(`/api/workspaces/check-slug?slug=${encodeURIComponent(slug)}`)).body;

    expect(await check('taken-one')).toEqual({ available: false });
    expect(await check('free-one')).toEqual({ available: true });
    expect(await check('api')).toMatchObject({ available: false, reason: 'This URL is reserved' });
    expect(await check('-bad')).toMatchObject({ available: false });
  });
});

describe('GET/PATCH/DELETE /w/:slug', () => {
  it('every role can view; the response carries my role', async () => {
    const t = await fourRoles();
    for (const [who, role] of [
      [t.owner, 'owner'],
      [t.admin, 'admin'],
      [t.member, 'member'],
      [t.viewer, 'viewer'],
    ] as const) {
      const res = await as(who.token).get(`/api/w/${t.ws.slug}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ workspace: { id: t.ws.id }, role });
    }
  });

  it('a non-member gets the same 404 as a slug that does not exist (AC-WS-01)', async () => {
    const t = await fourRoles();
    const foreign = await as(t.outsider.token).get(`/api/w/${t.ws.slug}`);
    const missing = await as(t.outsider.token).get('/api/w/does-not-exist');
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body.error.code).toBe(missing.body.error.code);
    expect(foreign.body.error.message).toBe(missing.body.error.message);
  });

  it('PATCH as owner and admin → 200 and an activity; member and viewer → 403', async () => {
    const t = await fourRoles();
    const url = `/api/w/${t.ws.slug}`;

    const ok = await as(t.owner.token)
      .patch(url)
      .send({ name: 'Renamed', timezone: 'Europe/Berlin' });
    expect(ok.status).toBe(200);
    expect(ok.body.workspace).toMatchObject({
      name: 'Renamed',
      settings: { timezone: 'Europe/Berlin' },
    });
    expect((await as(t.admin.token).patch(url).send({ name: 'By admin' })).status).toBe(200);

    for (const who of [t.member, t.viewer]) {
      const res = await as(who.token).patch(url).send({ name: 'Nope' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({
        code: 'FORBIDDEN',
        details: { permission: 'workspace:update' },
      });
    }

    const updates = await Activity.countDocuments({
      workspaceId: oid(t.ws.id),
      action: 'workspace.updated',
    });
    expect(updates).toBe(2);
  });

  it('a viewer gets 403, not 400, even for a garbage body (authorize runs before validate)', async () => {
    const t = await fourRoles();
    const res = await as(t.viewer.token).patch(`/api/w/${t.ws.slug}`).send({ name: 42 });
    expect(res.status).toBe(403);
  });

  it('PATCH working days and week start (FR-WS-06); duplicates and empty lists → 400', async () => {
    const t = await fourRoles();
    const url = `/api/w/${t.ws.slug}`;
    const ok = await as(t.owner.token)
      .patch(url)
      .send({ workingDays: [5, 1, 2], weekStartsOn: 0 });
    expect(ok.body.workspace.settings).toMatchObject({ workingDays: [1, 2, 5], weekStartsOn: 0 });

    for (const body of [{ workingDays: [] }, { workingDays: [1, 1] }, { weekStartsOn: 7 }]) {
      expect((await as(t.owner.token).patch(url).send(body)).status).toBe(400);
    }
  });

  it('an empty PATCH changes nothing and writes no activity', async () => {
    const t = await fourRoles();
    const res = await as(t.owner.token).patch(`/api/w/${t.ws.slug}`).send({});
    expect(res.status).toBe(200);
    expect(
      await Activity.countDocuments({ workspaceId: oid(t.ws.id), action: 'workspace.updated' }),
    ).toBe(0);
  });

  it('a role change applies on the very next request (FR-MEM-07)', async () => {
    const t = await fourRoles();
    const url = `/api/w/${t.ws.slug}`;
    expect((await as(t.admin.token).patch(url).send({ name: 'Still admin' })).status).toBe(200);
    await Membership.updateOne(
      { workspaceId: oid(t.ws.id), userId: oid(t.admin.user.id) },
      { $set: { role: 'viewer' } },
    );
    // Same access token, no re-login: the role is read from the DB on each request.
    expect((await as(t.admin.token).patch(url).send({ name: 'Now viewer' })).status).toBe(403);
  });

  it('DELETE: only the owner, with the exact name; then 404 for everyone and gone from /me', async () => {
    const t = await fourRoles();
    const url = `/api/w/${t.ws.slug}`;

    expect((await as(t.admin.token).delete(url).send({ confirmName: 'Roles Inc' })).status).toBe(
      403,
    );

    const wrong = await as(t.owner.token).delete(url).send({ confirmName: 'roles inc' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('CONFIRMATION_MISMATCH');

    expect((await as(t.owner.token).delete(url).send({ confirmName: 'Roles Inc' })).status).toBe(
      204,
    );

    for (const who of [t.owner, t.admin, t.member, t.viewer]) {
      expect((await as(who.token).get(url)).status).toBe(404); // AC-WS-02
      expect((await as(who.token).get('/api/me')).body.workspaces).toEqual([]);
    }
  });

  it('a soft-deleted workspace keeps its slug reserved', async () => {
    const owner = await registerUser();
    const ws = await makeWorkspace(owner.token, 'Gone Co');
    await as(owner.token).delete(`/api/w/${ws.slug}`).send({ confirmName: 'Gone Co' });

    const other = await registerUser();
    const res = await as(other.token).post('/api/workspaces').send({ name: 'Grab', slug: ws.slug });
    expect(res.status).toBe(409);
  });
});

describe('GET /me workspaces', () => {
  it('lists every workspace I belong to with my role in each, sorted by name', async () => {
    const me = await registerUser();
    const other = await registerUser();
    await makeWorkspace(me.token, 'Zeta Mine');
    const theirs = await makeWorkspace(other.token, 'Alpha Theirs');
    await Membership.create({
      workspaceId: oid(theirs.id),
      userId: oid(me.user.id),
      role: 'viewer',
    });

    const res = await as(me.token).get('/api/me');
    expect(
      res.body.workspaces.map((w: { name: string; role: string }) => [w.name, w.role]),
    ).toEqual([
      ['Alpha Theirs', 'viewer'],
      ['Zeta Mine', 'owner'],
    ]);
  });

  it('addMember helper gives the right role (sanity check for later tests)', async () => {
    const owner = await registerUser();
    const ws = await makeWorkspace(owner.token);
    const m = await addMember(ws, 'member');
    expect((await as(m.token).get(`/api/w/${ws.slug}`)).body.role).toBe('member');
  });
});
