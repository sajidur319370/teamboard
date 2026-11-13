import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import type { NotificationDto, Page } from '@teamboard/shared';
import { Notification, Task } from '../src/db/models';
import { PASSWORD, as, registerUser } from './helpers/auth';
import {
  addMember,
  makeComment,
  makeInvite,
  makeTask,
  makeTeam,
  type Team,
} from './helpers/tenants';
import { connect, disconnectAll, nextEvent, record, startServer, wait } from './helpers/sockets';

// Requirement §14: triggers N1–N8, FR-NTF-01..13.
const n = (t: Team) => `/api/w/${t.slug}/notifications`;
const list = async (t: Team, token: string, q = '') =>
  (await as(token).get(`${n(t)}${q}`)).body as Page<NotificationDto>;
const types = async (t: Team, token: string) => (await list(t, token)).items.map((x) => x.type);
const unread = async (t: Team, token: string) =>
  (await as(token).get(`${n(t)}/unread-count`)).body.count as number;
const patchTask = (t: Team, token: string, id: string, body: object) =>
  as(token).patch(`/api/w/${t.slug}/tasks/${id}`).send(body).expect(200);
const columnOf = (t: Team, category: string, i = 0) =>
  t.project.columns.filter((c) => c.category === category)[i]!;
const move = (
  t: Team,
  token: string,
  taskId: string,
  toColumnId: string,
  prevTaskId: string | null = null,
) =>
  as(token)
    .patch(`/api/w/${t.slug}/tasks/${taskId}/move`)
    .send({ toColumnId, prevTaskId, nextTaskId: null })
    .expect(200);

describe('triggers', () => {
  it('N1 + N5: assignees hear about it once per action, the actor never (FR-NTF-02/10)', async () => {
    const t = await makeTeam();
    const task = await makeTask(t.owner.token, t.ws, 'MOB', {
      title: 'X',
      assigneeIds: [t.member.user.id, t.owner.user.id],
    });
    await patchTask(t, t.owner.token, task.id, { priority: 'high' }); // a second action → N5

    const mine = (await list(t, t.member.token)).items;
    expect(mine.map((x) => x.type)).toEqual(['task.updated', 'task.assigned']); // newest first
    expect(mine[0]).toMatchObject({
      actor: { id: t.owner.user.id, name: 'Olivia Owner' },
      taskId: task.id,
      projectId: t.project.id,
      data: { projectKey: 'MOB', taskNumber: task.number, taskTitle: 'X', fields: ['priority'] },
      readAt: null,
    });
    expect(await unread(t, t.member.token)).toBe(2);
    const ownerHas = await Notification.countDocuments({
      workspaceId: t.ws.id,
      userId: t.owner.user.id,
      type: { $in: ['task.assigned', 'task.updated'] },
    });
    expect(ownerHas).toBe(0); // actor never notified
  });

  it('one PATCH that assigns AND changes the priority = ONE notification each (first rule wins)', async () => {
    const t = await makeTeam();
    const task = await makeTask(t.owner.token, t.ws, 'MOB', { assigneeIds: [t.member.user.id] });
    await patchTask(t, t.owner.token, task.id, {
      assigneeIds: [t.member.user.id, t.admin.user.id],
      dueDate: '2026-12-01',
    });
    expect(await types(t, t.admin.token)).toEqual(['task.assigned']); // not also task.updated
    expect(await types(t, t.member.token)).toEqual(['task.updated', 'task.assigned']);
  });

  it('N2: unassigned; and a title change alone notifies nobody', async () => {
    const t = await makeTeam();
    const task = await makeTask(t.owner.token, t.ws, 'MOB', { assigneeIds: [t.member.user.id] });
    await patchTask(t, t.owner.token, task.id, { title: 'Renamed' });
    await patchTask(t, t.owner.token, task.id, { assigneeIds: [] });
    expect(await types(t, t.member.token)).toEqual(['task.unassigned', 'task.assigned']);
  });

  it('N3: a comment notifies the watchers except the author', async () => {
    const t = await makeTeam();
    // reporter = member (watcher). The admin comments → becomes a watcher too.
    await makeComment(t.admin.token, t.ws, t.task.id, 'first from admin');
    expect(await types(t, t.member.token)).toEqual(['comment.created']);
    expect(await unread(t, t.admin.token)).toBe(0);

    await makeComment(t.member.token, t.ws, t.task.id, 'reply **bold**');
    const [latest] = (await list(t, t.admin.token)).items;
    expect(latest).toMatchObject({
      type: 'comment.created',
      data: { taskNumber: t.task.number, excerpt: 'reply **bold**' },
    });
    expect(await types(t, t.member.token)).toEqual(['comment.created']); // not for their own
  });

  it('N4: moving INTO done notifies reporter + watchers once; reorders inside Done do not', async () => {
    const t = await makeTeam();
    await patchTask(t, t.member.token, t.task.id, { assigneeIds: [t.admin.user.id] }); // admin watches
    const done = columnOf(t, 'done');
    await move(t, t.owner.token, t.task.id, done.id);
    expect(await types(t, t.member.token)).toEqual(['task.completed']);
    expect((await types(t, t.admin.token)).filter((x) => x === 'task.completed')).toHaveLength(1);

    // A second card in Done, then reorder the first below it: still done, NOT "completed again"
    const other = await makeTask(t.owner.token, t.ws, 'MOB');
    await move(t, t.owner.token, other.id, done.id);
    await move(t, t.owner.token, t.task.id, done.id, other.id);
    expect(await types(t, t.member.token)).toEqual(['task.completed']);
  });

  it('N6: a role change notifies that member, even when demoted to Viewer', async () => {
    const t = await makeTeam();
    await as(t.owner.token)
      .patch(`/api/w/${t.slug}/members/${t.member.user.id}`)
      .send({ role: 'viewer' })
      .expect(200);
    const [x] = (await list(t, t.member.token)).items;
    expect(x).toMatchObject({ type: 'member.role_changed', data: { role: 'viewer' } });
  });

  it('N7: accepting an invite notifies its creator', async () => {
    const t = await makeTeam();
    const before = await unread(t, t.admin.token);
    // the ADMIN creates the invite this time
    const inv = await makeInvite(t.admin.token, t.ws, { role: 'member' });
    const joiner = await registerUser('Jamal Joiner');
    await as(joiner.token).post(`/api/invites/${inv.token}/accept`).expect(200);
    expect(await unread(t, t.admin.token)).toBe(before + 1);
    const [x] = (await list(t, t.admin.token)).items;
    expect(x).toMatchObject({ type: 'invite.accepted', actor: { name: 'Jamal Joiner' } });
  });

  it('N8: becoming Owner', async () => {
    const t = await makeTeam();
    await as(t.owner.token)
      .post(`/api/w/${t.slug}/transfer-ownership`)
      .send({ userId: t.admin.user.id, password: PASSWORD })
      .expect(204);
    expect((await list(t, t.admin.token)).items[0]!.type).toBe('ownership.transferred');
  });

  it('E11: a removed member gets nothing more; Viewers get no task news (FR-NTF-03)', async () => {
    const t = await makeTeam();
    // The member reported t.task (watcher). Remove them, then comment.
    await as(t.owner.token).delete(`/api/w/${t.slug}/members/${t.member.user.id}`).expect(204);
    // A viewer who watches (e.g. demoted after commenting) is skipped for task news
    await Task.updateOne(
      { _id: t.task.id, workspaceId: t.ws.id },
      { $addToSet: { watcherIds: t.viewer.user.id } },
    );
    await makeComment(t.owner.token, t.ws, t.task.id, 'anyone there?');
    const got = await Notification.find({
      workspaceId: t.ws.id,
      userId: { $in: [t.member.user.id, t.viewer.user.id] },
    }).lean();
    expect(got).toEqual([]);
  });
});

describe('reading', () => {
  it('mark one read: own → 204 (idempotent, first readAt kept); someone else’s → 404', async () => {
    const t = await makeTeam();
    const id = t.notificationId; // the owner's
    expect((await as(t.admin.token).post(`${n(t)}/${id}/read`)).status).toBe(404);
    expect(
      (await as(t.owner.token).post(`${n(t)}/${String(new Types.ObjectId())}/read`)).status,
    ).toBe(404);

    await as(t.owner.token)
      .post(`${n(t)}/${id}/read`)
      .expect(204);
    const first = (await Notification.findOne({ _id: id, workspaceId: t.ws.id }).lean())!.readAt;
    expect(first).toBeInstanceOf(Date);
    await wait(5);
    await as(t.owner.token)
      .post(`${n(t)}/${id}/read`)
      .expect(204);
    const second = (await Notification.findOne({ _id: id, workspaceId: t.ws.id }).lean())!.readAt;
    expect(second).toEqual(first);
  });

  it('read-all → unread 0; ?unread=true lists only unread; other users untouched', async () => {
    const t = await makeTeam();
    await makeComment(t.admin.token, t.ws, t.task.id); // → member
    const ownerUnread = await unread(t, t.owner.token);
    expect(ownerUnread).toBe(4); // admin, member, viewer, target joined via the owner's invites
    await as(t.owner.token)
      .post(`${n(t)}/${t.notificationId}/read`)
      .expect(204);
    expect((await list(t, t.owner.token, '?unread=true')).items).toHaveLength(3);
    await as(t.owner.token)
      .post(`${n(t)}/read-all`)
      .expect(204);
    expect(await unread(t, t.owner.token)).toBe(0);
    expect((await list(t, t.owner.token, '?unread=true')).items).toEqual([]);
    expect((await list(t, t.owner.token)).items).toHaveLength(4); // still listed, just read
    expect(await unread(t, t.member.token)).toBe(1);
  });

  it('newest first, 20 per page, cursor without repeats', async () => {
    const t = await makeTeam();
    await Notification.insertMany(
      Array.from({ length: 25 }, (_, i) => ({
        workspaceId: t.ws.id,
        userId: t.member.user.id,
        type: 'comment.created',
        actorId: t.owner.user.id,
        data: { excerpt: `n${i}` },
        createdAt: new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 5)), // ties
      })),
    );
    const p1 = await list(t, t.member.token);
    expect(p1.items).toHaveLength(20);
    const p2 = await list(t, t.member.token, `?cursor=${p1.nextCursor}`);
    expect(p2.nextCursor).toBeNull();
    expect(new Set([...p1.items, ...p2.items].map((x) => x.id)).size).toBe(25);
  });

  it('a viewer can read their own notifications (notification:own = viewer)', async () => {
    const t = await makeTeam();
    expect((await as(t.viewer.token).get(n(t))).status).toBe(200);
    expect((await as(t.viewer.token).get(`${n(t)}/unread-count`)).body).toEqual({ count: 0 });
  });
});

describe('storage', () => {
  it('deleting the task deletes its notifications (no dead links); the rest stay', async () => {
    const t = await makeTeam();
    await makeComment(t.admin.token, t.ws, t.task.id); // → member, about t.task
    expect(await unread(t, t.member.token)).toBe(1);
    await as(t.member.token).delete(`/api/w/${t.slug}/tasks/${t.task.id}`).expect(204);
    expect(await unread(t, t.member.token)).toBe(0);
    expect(await unread(t, t.owner.token)).toBe(4); // invite.accepted: no task, untouched
  });

  it('deleting the project deletes its notifications', async () => {
    const t = await makeTeam();
    await makeComment(t.admin.token, t.ws, t.task.id);
    await as(t.owner.token)
      .delete(`/api/w/${t.slug}/projects/MOB`)
      .send({ confirmKey: 'MOB' })
      .expect(204);
    expect(
      await Notification.countDocuments({ workspaceId: t.ws.id, projectId: t.project.id }),
    ).toBe(0);
  });

  it('FR-NTF-09: a TTL index removes them after 90 days', async () => {
    const indexes = await Notification.collection.indexes();
    const ttl = indexes.find((i) => i.expireAfterSeconds !== undefined);
    expect(ttl).toMatchObject({ key: { createdAt: 1 }, expireAfterSeconds: 7_776_000 });
  });
});

describe('live (FR-NTF-05)', () => {
  let srv: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    srv = await startServer();
  });
  afterEach(() => disconnectAll());
  afterAll(async () => {
    await srv.close();
  });

  it('pushes notification:new to the recipient only, with their unread count', async () => {
    const t = await makeTeam();
    const memberSock = await connect(srv.port, t.member.token); // user room: no join needed
    const ownerSock = await connect(srv.port, t.owner.token);
    const ownerSaw = record(ownerSock);

    const got = nextEvent<{
      workspaceId: string;
      notification: NotificationDto;
      unreadCount: number;
    }>(memberSock, 'notification:new');
    await patchTask(t, t.owner.token, t.task.id, { assigneeIds: [t.member.user.id] });
    const p = await got;
    expect(p.workspaceId).toBe(t.ws.id);
    expect(p.unreadCount).toBe(1);
    expect(p.notification).toMatchObject({
      type: 'task.assigned',
      actor: { name: 'Olivia Owner' },
    });
    await wait(200);
    expect(ownerSaw.filter((e) => e.event === 'notification:new')).toEqual([]); // actor: nothing

    // Read in one tab → the other tabs' bell follows
    const synced = nextEvent<{ unreadCount: number }>(memberSock, 'notification:read');
    await as(t.member.token)
      .post(`${n(t)}/${p.notification.id}/read`)
      .expect(204);
    expect(await synced).toEqual({ workspaceId: t.ws.id, unreadCount: 0 });
  });

  it('a second invite-accepted counts up', async () => {
    const t = await makeTeam();
    const s = await connect(srv.port, t.owner.token);
    const got = nextEvent<{ unreadCount: number }>(s, 'notification:new');
    await addMember(t.owner.token, t.ws, 'member', 'Nina New');
    expect((await got).unreadCount).toBe(5);
  });
});
