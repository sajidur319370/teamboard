import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Activity, Membership, Workspace } from '../src/db/models';
import { subscribe } from '../src/events/publish';
import type { DomainEvent } from '../src/events/types';
import { PASSWORD, as } from './helpers/auth';
import { addMember, makeTeam, type Team } from './helpers/tenants';

const oid = (id: string) => new Types.ObjectId(id);

let events: DomainEvent[];
let off: () => void;
beforeEach(() => {
  events = [];
  off = subscribe((_ctx, e) => {
    events.push(e);
  });
});
afterEach(() => off());

const roleOf = async (t: Team, userId: string) =>
  (await Membership.findOne({ workspaceId: oid(t.ws.id), userId: oid(userId) }).lean())?.role;

describe('list members', () => {
  it('every role sees name, email, color, role and joined date, sorted by name (FR-MEM-01)', async () => {
    const t = await makeTeam();
    const res = await as(t.viewer.token).get(`/api/w/${t.slug}/members`);
    expect(res.status).toBe(200);
    expect(res.body.members.map((m: { name: string; role: string }) => [m.name, m.role])).toEqual([
      ['Arif Admin', 'admin'],
      ['Olivia Owner', 'owner'],
      ['Rahim Member', 'member'],
      ['Tariq Target', 'viewer'],
      ['Vera Viewer', 'viewer'],
    ]);
    expect(res.body.members[0]).toEqual({
      userId: t.admin.user.id,
      name: 'Arif Admin',
      email: t.admin.email,
      avatarColor: 'blue',
      role: 'admin',
      joinedAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});

describe('change role (role ceiling, requirement §5.3)', () => {
  const patch = (t: Team, who: keyof Team, userId: string, role: string) =>
    as((t[who] as { token: string }).token)
      .patch(`/api/w/${t.slug}/members/${userId}`)
      .send({ role });

  it('Admin: Viewer → Member is fine; writes an activity and publishes the change', async () => {
    const t = await makeTeam();
    const res = await patch(t, 'admin', t.target.user.id, 'member');
    expect(res.status).toBe(200);
    expect(res.body.member).toMatchObject({ userId: t.target.user.id, role: 'member' });
    expect(await roleOf(t, t.target.user.id)).toBe('member');
    const act = await Activity.findOne({
      workspaceId: oid(t.ws.id),
      action: 'member.role_changed',
    }).lean();
    expect(act!.metadata).toMatchObject({ from: 'viewer', to: 'member' });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'member.roleChanged', from: 'viewer' }),
    );
  });

  it("Admin can't touch another Admin or the Owner (FR-RBAC-01, AC-RBAC-03)", async () => {
    const t = await makeTeam();
    const otherAdmin = await addMember(t.owner.token, t.ws, 'admin', 'Second Admin');
    for (const userId of [otherAdmin.user.id, t.owner.user.id]) {
      const res = await patch(t, 'admin', userId, 'viewer');
      expect(res.status).toBe(403);
    }
    expect(await roleOf(t, t.owner.user.id)).toBe('owner');
    expect(await roleOf(t, otherAdmin.user.id)).toBe('admin');
  });

  it("Admin can't grant admin; the Owner can (FR-RBAC-02)", async () => {
    const t = await makeTeam();
    expect((await patch(t, 'admin', t.target.user.id, 'admin')).status).toBe(403);
    expect((await patch(t, 'owner', t.target.user.id, 'admin')).status).toBe(200);
    expect(await roleOf(t, t.target.user.id)).toBe('admin');
  });

  it('nobody can grant owner here (use transfer) → 400', async () => {
    const t = await makeTeam();
    expect((await patch(t, 'owner', t.admin.user.id, 'owner')).status).toBe(400);
  });

  it('nobody can change their own role (FR-RBAC-03)', async () => {
    const t = await makeTeam();
    const res = await patch(t, 'admin', t.admin.user.id, 'member');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_CHANGE_OWN_ROLE');
  });

  it('unknown user → 404; same role → 200 with no activity', async () => {
    const t = await makeTeam();
    expect((await patch(t, 'owner', String(new Types.ObjectId()), 'member')).status).toBe(404);
    expect((await patch(t, 'owner', t.target.user.id, 'viewer')).status).toBe(200);
    expect(
      await Activity.countDocuments({ workspaceId: oid(t.ws.id), action: 'member.role_changed' }),
    ).toBe(0);
  });

  it('a demoted member gets 403 on their very next write, no logout (AC-RBAC-02)', async () => {
    const t = await makeTeam();
    await patch(t, 'owner', t.admin.user.id, 'member');
    const res = await as(t.admin.token).patch(`/api/w/${t.slug}`).send({ name: 'Nope' });
    expect(res.status).toBe(403);
  });
});

describe('remove & leave', () => {
  it("Admin removes a Viewer → 204; the removed user's next request → 404 (FR-MEM-06)", async () => {
    const t = await makeTeam();
    const res = await as(t.admin.token).delete(`/api/w/${t.slug}/members/${t.target.user.id}`);
    expect(res.status).toBe(204);
    expect((await as(t.target.token).get(`/api/w/${t.slug}`)).status).toBe(404);
    expect((await as(t.target.token).get('/api/me')).body.workspaces).toEqual([]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'member.removed', reason: 'removed' }),
    );
    expect(
      await Activity.countDocuments({ workspaceId: oid(t.ws.id), action: 'member.removed' }),
    ).toBe(1);
  });

  it("Admin can't remove another Admin or the Owner; nobody removes themselves", async () => {
    const t = await makeTeam();
    const otherAdmin = await addMember(t.owner.token, t.ws, 'admin');
    for (const userId of [otherAdmin.user.id, t.owner.user.id]) {
      expect((await as(t.admin.token).delete(`/api/w/${t.slug}/members/${userId}`)).status).toBe(
        403,
      );
    }
    const self = await as(t.admin.token).delete(`/api/w/${t.slug}/members/${t.admin.user.id}`);
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('USE_LEAVE');
    const unknown = await as(t.owner.token).delete(
      `/api/w/${t.slug}/members/${new Types.ObjectId()}`,
    );
    expect(unknown.status).toBe(404);
  });

  it('a member can leave; then 404; the Owner must transfer first (BR-04)', async () => {
    const t = await makeTeam();
    expect((await as(t.member.token).post(`/api/w/${t.slug}/leave`)).status).toBe(204);
    expect((await as(t.member.token).get(`/api/w/${t.slug}`)).status).toBe(404);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'member.removed', reason: 'left' }),
    );

    const owner = await as(t.owner.token).post(`/api/w/${t.slug}/leave`);
    expect(owner.status).toBe(409);
    expect(owner.body.error.code).toBe('OWNER_MUST_TRANSFER');
  });
});

describe('transfer ownership (FR-MEM-05)', () => {
  const transfer = (t: Team, userId: string, password = PASSWORD) =>
    as(t.owner.token).post(`/api/w/${t.slug}/transfer-ownership`).send({ userId, password });

  async function assertNothingChanged(t: Team) {
    expect(await roleOf(t, t.owner.user.id)).toBe('owner');
    expect(await Membership.countDocuments({ workspaceId: oid(t.ws.id), role: 'owner' })).toBe(1);
    const ws = await Workspace.findById(t.ws.id).lean();
    expect(String(ws!.ownerId)).toBe(t.owner.user.id);
  }

  it('to an Admin: exactly one owner, the old owner becomes admin, workspace.ownerId moves', async () => {
    const t = await makeTeam();
    expect((await transfer(t, t.admin.user.id)).status).toBe(204);

    expect(await roleOf(t, t.admin.user.id)).toBe('owner');
    expect(await roleOf(t, t.owner.user.id)).toBe('admin');
    expect(await Membership.countDocuments({ workspaceId: oid(t.ws.id), role: 'owner' })).toBe(1);
    const ws = await Workspace.findById(t.ws.id).lean();
    expect(String(ws!.ownerId)).toBe(t.admin.user.id);
    expect(
      await Activity.countDocuments({ workspaceId: oid(t.ws.id), action: 'ownership.transferred' }),
    ).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'ownership.transferred' }));

    // The new owner has owner powers; the old one doesn't any more.
    expect(
      (await as(t.owner.token).delete(`/api/w/${t.slug}`).send({ confirmName: 'Roles Inc' }))
        .status,
    ).toBe(403);
  });

  it('to a Member → 400 TARGET_MUST_BE_ADMIN and NOTHING changed (rollback)', async () => {
    const t = await makeTeam();
    const res = await transfer(t, t.member.user.id);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TARGET_MUST_BE_ADMIN');
    await assertNothingChanged(t);
    expect(await roleOf(t, t.member.user.id)).toBe('member');
  });

  it('to someone outside the workspace, or to yourself → 400 and nothing changed', async () => {
    const t = await makeTeam();
    expect((await transfer(t, t.outsider.user.id)).status).toBe(400);
    expect((await transfer(t, t.owner.user.id)).status).toBe(400);
    await assertNothingChanged(t);
  });

  it('a wrong password → 400 WRONG_PASSWORD and nothing changed', async () => {
    const t = await makeTeam();
    const res = await transfer(t, t.admin.user.id, 'Wrong1234');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WRONG_PASSWORD');
    await assertNothingChanged(t);
  });
});

describe('workspace delete publishes the member list', () => {
  it('workspace.deleted carries every member id (the socket layer kicks them on Day 14)', async () => {
    const t = await makeTeam();
    await as(t.owner.token).delete(`/api/w/${t.slug}`).send({ confirmName: 'Roles Inc' });
    const ev = events.find((e) => e.type === 'workspace.deleted');
    expect(ev && ev.type === 'workspace.deleted' && ev.memberIds.map(String).sort()).toEqual(
      [t.owner, t.admin, t.member, t.viewer, t.target].map((u) => u.user.id).sort(),
    );
  });
});
