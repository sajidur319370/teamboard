import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '@teamboard/shared';
import { Activity, Invite, Membership } from '../src/db/models';
import { sha256 } from '../src/lib/crypto';
import { subscribe } from '../src/events/publish';
import type { DomainEvent } from '../src/events/types';
import { app } from './setup/app';
import { as, registerUser } from './helpers/auth';
import { addMember, makeInvite, makeTeam, makeWorkspace } from './helpers/tenants';

const oid = (id: string) => new Types.ObjectId(id);
const accept = (userToken: string, inviteToken: string) =>
  as(userToken).post(`/api/invites/${inviteToken}/accept`);

let events: DomainEvent[];
let off: () => void;
beforeEach(() => {
  events = [];
  off = subscribe((_ctx, e) => {
    events.push(e);
  });
});
afterEach(() => off());

async function ownerWithWorkspace() {
  const owner = await registerUser('Owner');
  const ws = await makeWorkspace(owner.token, 'Invite Co');
  return { owner, ws };
}

describe('create & list invites', () => {
  it('201 with a one-time URL; only the SHA-256 hash is stored (AC-INV-04)', async () => {
    const { owner, ws } = await ownerWithWorkspace();
    const res = await as(owner.token).post(`/api/w/${ws.slug}/invites`).send({ role: 'member' });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^http:\/\/localhost:5173\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(res.body.invite).toMatchObject({
      role: 'member',
      maxUses: 10, // defaults (FR-INV-01)
      uses: 0,
      email: null,
      status: 'active',
      createdBy: owner.user.id,
    });
    const days = (Date.parse(res.body.invite.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    const token = new URL(res.body.url).pathname.split('/').pop()!;
    const stored = await Invite.findOne({ workspaceId: oid(ws.id) }).lean();
    expect(stored!.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(JSON.stringify(res.body.invite)).not.toContain('tokenHash');

    const act = await Activity.findOne({ workspaceId: oid(ws.id), action: 'invite.created' });
    expect(act).toBeTruthy();
  });

  it('role ceiling: an Admin creating an admin invite → 403; the Owner can (AC-INV-02)', async () => {
    const t = await makeTeam();
    const byAdmin = await as(t.admin.token)
      .post(`/api/w/${t.slug}/invites`)
      .send({ role: 'admin' });
    expect(byAdmin.status).toBe(403);
    expect(byAdmin.body.error.code).toBe('ROLE_CEILING');
    const byOwner = await as(t.owner.token)
      .post(`/api/w/${t.slug}/invites`)
      .send({ role: 'admin' });
    expect(byOwner.status).toBe(201);
    const memberInvite = await as(t.admin.token)
      .post(`/api/w/${t.slug}/invites`)
      .send({ role: 'member' });
    expect(memberInvite.status).toBe(201);
  });

  it('rejects owner invites, bad expiry and bad max uses', async () => {
    const { owner, ws } = await ownerWithWorkspace();
    for (const body of [
      { role: 'owner' },
      { role: 'member', expiresInDays: 5 },
      { role: 'member', maxUses: 0 },
      { role: 'member', maxUses: LIMITS.inviteMaxUses + 1 },
      { role: 'member', email: 'not-an-email' },
    ]) {
      expect((await as(owner.token).post(`/api/w/${ws.slug}/invites`).send(body)).status).toBe(400);
    }
  });

  it('the list shows only active invites, newest first (FR-INV-03)', async () => {
    const { owner, ws } = await ownerWithWorkspace();
    const old = await makeInvite(owner.token, ws, { role: 'viewer' });
    const revoked = await makeInvite(owner.token, ws, { role: 'viewer' });
    const used = await makeInvite(owner.token, ws, { role: 'viewer', maxUses: 1 });
    const fresh = await makeInvite(owner.token, ws, { role: 'member' });
    await as(owner.token).delete(`/api/w/${ws.slug}/invites/${revoked.id}`);
    await accept((await registerUser()).token, used.token);

    const res = await as(owner.token).get(`/api/w/${ws.slug}/invites`);
    expect(res.body.invites.map((i: { id: string }) => i.id)).toEqual([fresh.id, old.id]);
  });
});

describe('revoke', () => {
  it('stops the link immediately; revoking twice is fine; unknown → 404', async () => {
    const { owner, ws } = await ownerWithWorkspace();
    const inv = await makeInvite(owner.token, ws, { role: 'member' });
    const url = `/api/w/${ws.slug}/invites/${inv.id}`;

    expect((await as(owner.token).delete(url)).status).toBe(204);
    expect((await as(owner.token).delete(url)).status).toBe(204); // idempotent
    expect(
      await Activity.countDocuments({ workspaceId: oid(ws.id), action: 'invite.revoked' }),
    ).toBe(1);

    const res = await accept((await registerUser()).token, inv.token);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('INVITE_REVOKED');

    const unknown = await as(owner.token).delete(
      `/api/w/${ws.slug}/invites/${new Types.ObjectId()}`,
    );
    expect(unknown.status).toBe(404);
  });

  it("an Admin can't revoke an admin invite, but can revoke member/viewer ones (FR-INV-04)", async () => {
    const t = await makeTeam();
    const adminInv = await makeInvite(t.owner.token, t.ws, { role: 'admin' });
    const res = await as(t.admin.token).delete(`/api/w/${t.slug}/invites/${adminInv.id}`);
    expect(res.status).toBe(403);
    expect((await as(t.admin.token).delete(`/api/w/${t.slug}/invites/${t.inviteId}`)).status).toBe(
      204,
    );
  });
});

describe('preview (guest)', () => {
  it('shows workspace, role, inviter and status without logging in (FR-INV-05)', async () => {
    const { owner, ws } = await ownerWithWorkspace();
    const inv = await makeInvite(owner.token, ws, { role: 'member', email: 'x@test.dev' });
    const res = await request(app).get(`/api/invites/${inv.token}`);
    expect(res.status).toBe(200);
    expect(res.body.invite).toEqual({
      workspace: { name: 'Invite Co', slug: ws.slug },
      role: 'member',
      status: 'active',
      emailLocked: true,
      inviterName: 'Owner',
    });
  });

  it('unknown token or a deleted workspace → 404; an expired one shows its status', async () => {
    const { owner, ws } = await ownerWithWorkspace();
    expect((await request(app).get(`/api/invites/${'x'.repeat(43)}`)).status).toBe(404);

    const inv = await makeInvite(owner.token, ws, { role: 'member' });
    await Invite.updateOne(
      { _id: oid(inv.id), workspaceId: oid(ws.id) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect((await request(app).get(`/api/invites/${inv.token}`)).body.invite.status).toBe(
      'expired',
    );

    await as(owner.token).delete(`/api/w/${ws.slug}`).send({ confirmName: 'Invite Co' });
    expect((await request(app).get(`/api/invites/${inv.token}`)).status).toBe(404);
  });
});

describe('accept', () => {
  it('joins with the invite role, consumes one use, logs the activity and publishes member.joined', async () => {
    const { owner, ws } = await ownerWithWorkspace();
    const inv = await makeInvite(owner.token, ws, { role: 'member', maxUses: 3 });
    const joiner = await registerUser('Joiner');

    const res = await accept(joiner.token, inv.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ slug: ws.slug });

    const me = await as(joiner.token).get('/api/me');
    expect(me.body.workspaces).toEqual([
      { id: ws.id, name: 'Invite Co', slug: ws.slug, role: 'member' },
    ]);
    const stored = await Invite.findOne({ _id: oid(inv.id), workspaceId: oid(ws.id) }).lean();
    expect(stored!.uses).toBe(1);
    const m = await Membership.findOne({ workspaceId: oid(ws.id), userId: oid(joiner.user.id) });
    expect(String(m!.invitedBy)).toBe(owner.user.id);
    expect(
      await Activity.countDocuments({
        workspaceId: oid(ws.id),
        actorId: oid(joiner.user.id),
        action: 'member.joined',
      }),
    ).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'member.joined',
        member: expect.objectContaining({ userId: joiner.user.id, role: 'member' }),
      }),
    );
  });

  it('requires login', async () => {
    const { owner, ws } = await ownerWithWorkspace();
    const inv = await makeInvite(owner.token, ws, { role: 'member' });
    expect((await request(app).post(`/api/invites/${inv.token}/accept`)).status).toBe(401);
  });

  it('two people race for the last use: exactly one wins (TR-05, AC-INV-01)', async () => {
    const { owner, ws } = await ownerWithWorkspace();
    const inv = await makeInvite(owner.token, ws, { role: 'member', maxUses: 1 });
    const [u1, u2] = await Promise.all([registerUser(), registerUser()]);

    const results = await Promise.all([accept(u1.token, inv.token), accept(u2.token, inv.token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(results.find((r) => r.status === 410)!.body.error.code).toBe('INVITE_USED_UP');
    expect(await Membership.countDocuments({ workspaceId: oid(ws.id) })).toBe(2); // owner + 1
  });

  it('the same user double-clicking: both 200, one membership, one use', async () => {
    const { owner, ws } = await ownerWithWorkspace();
    const inv = await makeInvite(owner.token, ws, { role: 'member', maxUses: 5 });
    const u = await registerUser();
    const results = await Promise.all([accept(u.token, inv.token), accept(u.token, inv.token)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(
      await Membership.countDocuments({ workspaceId: oid(ws.id), userId: oid(u.user.id) }),
    ).toBe(1);
    const stored = await Invite.findOne({ _id: oid(inv.id), workspaceId: oid(ws.id) }).lean();
    expect(stored!.uses).toBe(1);
  });

  it('expired → 410 INVITE_EXPIRED; used up → 410 INVITE_USED_UP', async () => {
    const { owner, ws } = await ownerWithWorkspace();
    const expired = await makeInvite(owner.token, ws, { role: 'member' });
    await Invite.updateOne(
      { _id: oid(expired.id), workspaceId: oid(ws.id) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const res = await accept((await registerUser()).token, expired.token);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('INVITE_EXPIRED');

    const single = await makeInvite(owner.token, ws, { role: 'member', maxUses: 1 });
    await accept((await registerUser()).token, single.token);
    const late = await accept((await registerUser()).token, single.token);
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('INVITE_USED_UP');
  });

  it('an email lock: another email → 403 INVITE_EMAIL_MISMATCH; the right one (any case) joins (AC-INV-03)', async () => {
    const { owner, ws } = await ownerWithWorkspace();
    const right = await registerUser();
    const inv = await makeInvite(owner.token, ws, {
      role: 'member',
      email: right.email.toUpperCase(),
    });

    const wrong = await accept((await registerUser()).token, inv.token);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('INVITE_EMAIL_MISMATCH');
    expect((await accept(right.token, inv.token)).status).toBe(200);
  });

  it('already a member → 200 { slug }, no use consumed, role unchanged (FR-INV-07)', async () => {
    const t = await makeTeam();
    const adminInvite = await makeInvite(t.owner.token, t.ws, { role: 'admin' });
    const res = await accept(t.viewer.token, adminInvite.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ slug: t.slug });
    expect((await as(t.viewer.token).get(`/api/w/${t.slug}`)).body.role).toBe('viewer');
    const stored = await Invite.findOne({ _id: oid(adminInvite.id), workspaceId: oid(t.ws.id) });
    expect(stored!.uses).toBe(0);
  });

  it(`a full workspace (${LIMITS.membersPerWorkspace} members) → 409 MEMBER_LIMIT`, async () => {
    const { owner, ws } = await ownerWithWorkspace();
    await Membership.insertMany(
      Array.from({ length: LIMITS.membersPerWorkspace - 1 }, () => ({
        workspaceId: oid(ws.id),
        userId: new Types.ObjectId(),
        role: 'viewer',
      })),
    );
    const inv = await makeInvite(owner.token, ws, { role: 'member' });
    const res = await accept((await registerUser()).token, inv.token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MEMBER_LIMIT');
  });

  it('works through the helper used by every later test', async () => {
    const { owner, ws } = await ownerWithWorkspace();
    const m = await addMember(owner.token, ws, 'viewer');
    expect((await as(m.token).get(`/api/w/${ws.slug}`)).body.role).toBe('viewer');
  });
});
