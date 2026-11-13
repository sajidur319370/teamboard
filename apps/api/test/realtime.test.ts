import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { as } from './helpers/auth';
import { makeTask, makeTeam, twoTenants, type Team } from './helpers/tenants';
import {
  connect,
  disconnectAll,
  emitAck,
  nextEvent,
  record,
  startServer,
  wait,
} from './helpers/sockets';

// TR-06: handshake auth, room checks, broadcasts after commit, no cross-tenant events,
// forced leave on removal.
let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  srv = await startServer();
});
afterEach(() => disconnectAll());
afterAll(async () => {
  await srv.close();
});

async function onBoard(token: string, workspaceId: string, projectId: string): Promise<Socket> {
  const s = await connect(srv.port, token);
  expect(await emitAck(s, 'workspace:join', { workspaceId })).toEqual({ ok: true });
  expect(await emitAck(s, 'board:join', { projectId })).toEqual({ ok: true });
  return s;
}
const boardOf = (t: Team) => onBoard(t.member.token, t.ws.id, t.project.id);

describe('handshake (FR-RT-01, FR-RT-02)', () => {
  it('rejects a missing or bad token with UNAUTHENTICATED', async () => {
    await expect(connect(srv.port, 'nope')).rejects.toThrow('UNAUTHENTICATED');
    await expect(connect(srv.port, '')).rejects.toThrow('UNAUTHENTICATED');
  });

  it('a valid token connects and joins the user room automatically', async () => {
    const t = await makeTeam();
    const s = await connect(srv.port, t.member.token);
    const changed = nextEvent(s, 'membership:roleChanged'); // arrives via user:<id> without any join
    await as(t.owner.token)
      .patch(`/api/w/${t.slug}/members/${t.member.user.id}`)
      .send({ role: 'viewer' });
    expect(await changed).toEqual({ workspaceId: t.ws.id, role: 'viewer' });
  });
});

describe('rooms (FR-RT-03, FR-RT-04)', () => {
  it('board:join needs a workspace first, valid ids, and a project of THAT workspace', async () => {
    const t = await makeTeam();
    const s = await connect(srv.port, t.member.token);
    expect(await emitAck(s, 'board:join', { projectId: t.project.id })).toEqual({
      ok: false,
      code: 'JOIN_WORKSPACE_FIRST',
    });
    expect(await emitAck(s, 'workspace:join', { workspaceId: 'nope' })).toEqual({
      ok: false,
      code: 'VALIDATION_ERROR',
    });
    await emitAck(s, 'workspace:join', { workspaceId: t.ws.id });
    expect(await emitAck(s, 'board:join', { projectId: String(new Types.ObjectId()) })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it("can't join another tenant's workspace or board, and hears nothing from it (AC-RT-02)", async () => {
    const { a, b } = await twoTenants();
    const s = await connect(srv.port, a.token);
    const seen = record(s);
    await emitAck(s, 'workspace:join', { workspaceId: a.ws.id });
    expect(await emitAck(s, 'board:join', { projectId: b.project.id })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(await emitAck(s, 'workspace:join', { workspaceId: b.ws.id })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });

    // Lots of activity in B: tasks, a move, a column, a project change.
    const bt = await makeTask(b.token, b.ws, b.project.key, { title: 'secret' });
    await as(b.token).patch(`/api/w/${b.ws.slug}/tasks/${bt.id}/move`).send({
      toColumnId: b.project.columns[1]!.id,
      prevTaskId: null,
      nextTaskId: null,
    });
    await as(b.token)
      .post(`/api/w/${b.ws.slug}/projects/${b.project.key}/columns`)
      .send({ name: 'QA', category: 'in_progress' });
    await as(b.token)
      .patch(`/api/w/${b.ws.slug}/projects/${b.project.key}`)
      .send({ name: 'Renamed' });
    await wait(300);
    expect(seen).toEqual([]);
  });

  it('switching workspace leaves the previous workspace AND its boards', async () => {
    const t = await makeTeam();
    const other = await as(t.member.token)
      .post('/api/workspaces')
      .send({ name: 'Side Gig', slug: `side-${Date.now()}` });
    const s = await boardOf(t);
    await emitAck(s, 'workspace:join', { workspaceId: other.body.workspace.id });
    const seen = record(s);
    await makeTask(t.owner.token, t.ws, 'MOB', { title: 'not for you any more' });
    await wait(300);
    expect(seen).toEqual([]);
  });

  it('board:leave stops board events', async () => {
    const t = await makeTeam();
    const s = await boardOf(t);
    s.emit('board:leave', { projectId: t.project.id });
    await wait(100);
    const seen = record(s);
    await makeTask(t.owner.token, t.ws, 'MOB');
    await wait(300);
    expect(seen.filter((e) => e.event.startsWith('task:'))).toEqual([]);
  });

  it('clients cannot write over the socket: unknown events are ignored (FR-RT-05)', async () => {
    const t = await makeTeam();
    const s = await boardOf(t);
    s.emit('task:update', { taskId: t.task.id, title: 'pwned' });
    s.emit('task:created', { task: { title: 'fake' } });
    await wait(200);
    const task = await as(t.owner.token).get(
      `/api/w/${t.slug}/projects/MOB/tasks/${t.task.number}`,
    );
    expect(task.body.task.title).toBe('Fixture task');
    expect(s.connected).toBe(true);
  });
});

describe('broadcasts (FR-RT-06, FR-RT-07)', () => {
  it('a move reaches other members with the full task, version, envelope and clientMutationId', async () => {
    const t = await makeTeam();
    const s = await boardOf(t);
    const done = t.project.columns[3]!.id;
    const event = nextEvent<Record<string, unknown>>(s, 'task:moved');
    await as(t.owner.token)
      .patch(`/api/w/${t.slug}/tasks/${t.task.id}/move`)
      .send({ toColumnId: done, prevTaskId: null, nextTaskId: null, clientMutationId: 'cm-1' });

    const payload = await event;
    expect(payload).toMatchObject({
      workspaceId: t.ws.id,
      projectId: t.project.id,
      actorId: t.owner.user.id,
      clientMutationId: 'cm-1',
      fromColumnId: t.project.columns[0]!.id,
      task: { id: t.task.id, columnId: done, version: 2, rank: expect.any(String) },
    });
    expect(new Date(payload.emittedAt as string).getTime()).toBeGreaterThan(Date.now() - 5000);
    expect((payload.task as { completedAt: string }).completedAt).toEqual(expect.any(String));
  });

  it('create, update and delete reach the board; the header clientMutationId travels too', async () => {
    const t = await makeTeam();
    const s = await boardOf(t);
    const created = nextEvent<{ task: { id: string } }>(s, 'task:created');
    const task = await makeTask(t.owner.token, t.ws, 'MOB', { title: 'Live' });
    expect((await created).task.id).toBe(task.id);

    const updated = nextEvent<{
      changedFields: string[];
      clientMutationId: string;
      task: { version: number };
    }>(s, 'task:updated');
    await as(t.owner.token)
      .patch(`/api/w/${t.slug}/tasks/${task.id}`)
      .set('X-Client-Mutation-Id', 'cm-hdr')
      .send({ priority: 'high' });
    expect(await updated).toMatchObject({
      changedFields: ['priority'],
      clientMutationId: 'cm-hdr',
      task: { version: 2 },
    });

    const deleted = nextEvent(s, 'task:deleted');
    await as(t.owner.token).delete(`/api/w/${t.slug}/tasks/${task.id}`);
    expect(await deleted).toMatchObject({ taskId: task.id, number: task.number });
  });

  it('column changes carry the full ordered list', async () => {
    const t = await makeTeam();
    const s = await boardOf(t);
    const ev = nextEvent<{ columns: { name: string }[] }>(s, 'column:created');
    await as(t.owner.token)
      .post(`/api/w/${t.slug}/projects/MOB/columns`)
      .send({ name: 'QA', category: 'in_progress' });
    expect((await ev).columns.map((c) => c.name)).toEqual([
      'To Do',
      'In Progress',
      'Review',
      'Done',
      'QA',
    ]);
  });

  it('project changes reach the workspace room AND the project board', async () => {
    const t = await makeTeam();
    const onlyWs = await connect(srv.port, t.viewer.token);
    await emitAck(onlyWs, 'workspace:join', { workspaceId: t.ws.id });
    const onBoardSocket = await boardOf(t);
    const toWs = nextEvent<{ project: { archivedAt: string } }>(onlyWs, 'project:archived');
    const toBoard = nextEvent<{ project: { archivedAt: string } }>(
      onBoardSocket,
      'project:archived',
    );
    await as(t.owner.token).post(`/api/w/${t.slug}/projects/MOB/archive`);
    expect((await toWs).project.archivedAt).toEqual(expect.any(String));
    expect((await toBoard).project.archivedAt).toEqual(expect.any(String));

    const unarchived = nextEvent(onlyWs, 'project:updated'); // unarchive → project:updated
    await as(t.owner.token).post(`/api/w/${t.slug}/projects/MOB/unarchive`);
    await unarchived;
  });

  it('a failed write broadcasts NOTHING (only committed changes go out)', async () => {
    const t = await makeTeam();
    const s = await boardOf(t);
    const seen = record(s);
    await as(t.owner.token)
      .post(`/api/w/${t.slug}/projects/MOB/tasks`)
      .send({ title: 'x', assigneeIds: [t.viewer.user.id] }); // 400
    await as(t.viewer.token).post(`/api/w/${t.slug}/projects/MOB/tasks`).send({ title: 'x' }); // 403
    await as(t.owner.token).patch(`/api/w/${t.slug}/tasks/${t.task.id}/move`).send({
      toColumnId: t.project.columns[0]!.id,
      prevTaskId: null,
      nextTaskId: null,
    }); // drop in place → noop
    await wait(300);
    expect(seen).toEqual([]);
  });
});

describe('membership changes (FR-RT-11, FR-RT-12, AC-RT-03)', () => {
  it('a removed member is kicked out and gets no more board events', async () => {
    const t = await makeTeam();
    const s = await boardOf(t);
    const revoked = nextEvent(s, 'membership:revoked');
    await as(t.owner.token).delete(`/api/w/${t.slug}/members/${t.member.user.id}`);
    expect(await revoked).toEqual({ workspaceId: t.ws.id });

    const seen = record(s);
    await makeTask(t.owner.token, t.ws, 'MOB', { title: 'after removal' });
    await wait(300);
    expect(seen).toEqual([]);
    // ...and can't sneak back in with the same socket
    expect(await emitAck(s, 'board:join', { projectId: t.project.id })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('others in the workspace hear member:removed / member:joined', async () => {
    const t = await makeTeam();
    const s = await connect(srv.port, t.admin.token);
    await emitAck(s, 'workspace:join', { workspaceId: t.ws.id });
    const removed = nextEvent(s, 'member:removed');
    await as(t.owner.token).delete(`/api/w/${t.slug}/members/${t.target.user.id}`);
    expect(await removed).toMatchObject({ userId: t.target.user.id });
  });

  it('ownership transfer tells both people their new role', async () => {
    const t = await makeTeam();
    const ownerS = await connect(srv.port, t.owner.token);
    const adminS = await connect(srv.port, t.admin.token);
    const toOwner = nextEvent(ownerS, 'membership:roleChanged');
    const toAdmin = nextEvent(adminS, 'membership:roleChanged');
    await as(t.owner.token)
      .post(`/api/w/${t.slug}/transfer-ownership`)
      .send({ userId: t.admin.user.id, password: 'Passw0rd!' });
    expect(await toOwner).toEqual({ workspaceId: t.ws.id, role: 'admin' });
    expect(await toAdmin).toEqual({ workspaceId: t.ws.id, role: 'owner' });
  });

  it('deleting the workspace revokes everyone', async () => {
    const t = await makeTeam();
    const viewerS = await boardOf({ ...t, member: t.viewer });
    const revoked = nextEvent(viewerS, 'membership:revoked');
    await as(t.owner.token).delete(`/api/w/${t.slug}`).send({ confirmName: 'Roles Inc' });
    expect(await revoked).toEqual({ workspaceId: t.ws.id });
  });
});
