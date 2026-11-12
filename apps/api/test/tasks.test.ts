import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActivityAction, TaskDto } from '@teamboard/shared';
import { Activity, Task } from '../src/db/models';
import { subscribe } from '../src/events/publish';
import type { DomainEvent } from '../src/events/types';
import { as } from './helpers/auth';
import { addMember, makeTask, makeTeam, twoTenants, type Team } from './helpers/tenants';

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

const tasksUrl = (t: Team) => `/api/w/${t.slug}/projects/MOB/tasks`;
const taskUrl = (t: Team, id: string) => `/api/w/${t.slug}/tasks/${id}`;
const get = async (t: Team, number: number) =>
  (await as(t.viewer.token).get(`${tasksUrl(t)}/${number}`)).body.task as TaskDto;
const acts = (t: Team, action: ActivityAction) =>
  Activity.find({ workspaceId: oid(t.ws.id), action }).lean();

describe('create task', () => {
  it('defaults: first todo column, priority none, me as reporter + watcher, next number', async () => {
    const t = await makeTeam(); // the fixture task is MOB-1
    const res = await as(t.member.token).post(tasksUrl(t)).send({ title: '  Login screen  ' });
    expect(res.status).toBe(201);
    expect(res.body.task).toMatchObject({
      number: 2,
      title: 'Login screen',
      columnId: t.project.columns[0]!.id,
      priority: 'none',
      assigneeIds: [],
      reporterId: t.member.user.id,
      watcherIds: [t.member.user.id],
      completedAt: null,
      dueDate: null,
      storyPoints: null,
      version: 1,
    });
    expect(await acts(t, 'task.created')).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({ type: 'task.created' }));
  });

  it('with every field; assignees become watchers; a done column completes it', async () => {
    const t = await makeTeam();
    const done = t.project.columns[3]!;
    const task = await makeTask(t.owner.token, t.ws, 'MOB', {
      title: 'Ship it',
      description: '# Notes\n<script>alert(1)</script>', // stored as written; rendered safely
      columnId: done.id,
      assigneeIds: [t.member.user.id, t.admin.user.id],
      priority: 'urgent',
      dueDate: '2026-12-31',
      labelIds: [t.label.id],
      storyPoints: 5,
    });
    expect(task).toMatchObject({
      columnId: done.id,
      priority: 'urgent',
      dueDate: '2026-12-31',
      labelIds: [t.label.id],
      storyPoints: 5,
      description: '# Notes\n<script>alert(1)</script>',
    });
    expect(task.completedAt).toEqual(expect.any(String));
    expect(task.watcherIds.sort()).toEqual(
      [t.owner.user.id, t.member.user.id, t.admin.user.id].sort(),
    );
  });

  it('strips control characters from title and description', async () => {
    const t = await makeTeam();
    const task = await makeTask(t.owner.token, t.ws, 'MOB', {
      title: 'Bad\u0000title\u0007',
      description: 'line1\nline2\u001b',
    });
    expect(task.title).toBe('Badtitle');
    expect(task.description).toBe('line1\nline2');
  });

  it('rejects bad references: unknown/foreign column, unknown label, viewer/outsider assignee', async () => {
    const tt = await twoTenants();
    const t = await makeTeam();
    const cases: [object, string][] = [
      [{ columnId: String(new Types.ObjectId()) }, 'INVALID_COLUMN'],
      [{ columnId: tt.b.project.columns[0]!.id }, 'INVALID_COLUMN'],
      [{ labelIds: [tt.b.label.id] }, 'INVALID_LABEL'],
      [{ assigneeIds: [t.viewer.user.id] }, 'INVALID_ASSIGNEE'], // AC-TSK-03 / BR-10
      [{ assigneeIds: [t.outsider.user.id] }, 'INVALID_ASSIGNEE'],
    ];
    for (const [body, code] of cases) {
      const res = await as(t.owner.token)
        .post(tasksUrl(t))
        .send({ title: 'X', ...body });
      expect(res.status, code).toBe(400);
      expect(res.body.error.code).toBe(code);
    }
  });

  it('rejected creates do NOT burn a number', async () => {
    const t = await makeTeam();
    for (let i = 0; i < 3; i++) {
      await as(t.owner.token)
        .post(tasksUrl(t))
        .send({ title: 'X', assigneeIds: [t.viewer.user.id] });
    }
    expect((await makeTask(t.owner.token, t.ws, 'MOB')).number).toBe(2);
  });

  it('validation: empty title, bad date, bad points, too many assignees → 400', async () => {
    const t = await makeTeam();
    for (const body of [
      { title: '   ' },
      { title: 'x'.repeat(201) },
      { title: 'X', dueDate: '2026-02-30' },
      { title: 'X', dueDate: '1999-12-31' },
      { title: 'X', storyPoints: 4 },
      { title: 'X', priority: 'asap' },
      { title: 'X', assigneeIds: Array.from({ length: 6 }, () => String(new Types.ObjectId())) },
    ]) {
      expect(
        (await as(t.owner.token).post(tasksUrl(t)).send(body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
  });

  it('50 parallel creates → numbers 2..51, no gaps, no duplicates (AC-TSK-01)', async () => {
    const t = await makeTeam(); // MOB-1 exists
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        as(t.owner.token)
          .post(tasksUrl(t))
          .send({ title: `T${i}` }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.task.number as number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 2));
    // ...and their ranks give a strict order inside the column
    const ranks = (
      await Task.find({ workspaceId: oid(t.ws.id) })
        .select('rank')
        .lean()
    ).map((x) => x.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('archived project → 409 PROJECT_ARCHIVED', async () => {
    const t = await makeTeam();
    await as(t.owner.token).post(`/api/w/${t.slug}/projects/MOB/archive`);
    const res = await as(t.owner.token).post(tasksUrl(t)).send({ title: 'X' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
  });
});

describe('update task', () => {
  it('parallel edits of different fields both survive (AC-TSK-02)', async () => {
    const t = await makeTeam();
    await Promise.all([
      as(t.owner.token).patch(taskUrl(t, t.task.id)).send({ title: 'New title' }),
      as(t.member.token).patch(taskUrl(t, t.task.id)).send({ priority: 'high' }),
    ]);
    expect(await get(t, t.task.number)).toMatchObject({
      title: 'New title',
      priority: 'high',
      version: 3,
    });
  });

  it('one activity per changed field; unchanged fields are ignored; nothing changed → no bump', async () => {
    const t = await makeTeam();
    const res = await as(t.member.token)
      .patch(taskUrl(t, t.task.id))
      .send({
        title: 'Fixture task',
        priority: 'low',
        dueDate: '2027-01-15',
        labelIds: [t.label.id],
      });
    expect(res.body.task.version).toBe(2);
    const updates = await acts(t, 'task.updated');
    expect(updates.map((a) => (a.metadata as { field: string }).field).sort()).toEqual([
      'dueDate',
      'labelIds',
      'priority',
    ]);
    const labelAct = updates.find((a) => (a.metadata as { field: string }).field === 'labelIds')!;
    expect(labelAct.metadata).toMatchObject({ from: [], to: [t.label.id] }); // ids as strings

    const same = await as(t.member.token).patch(taskUrl(t, t.task.id)).send({ priority: 'low' });
    expect(same.body.task.version).toBe(2);
    expect(await acts(t, 'task.updated')).toHaveLength(3);
  });

  it('description changes are logged by field name only (no 10k-char copies)', async () => {
    const t = await makeTeam();
    await as(t.member.token)
      .patch(taskUrl(t, t.task.id))
      .send({ description: 'x'.repeat(5000) });
    const [a] = await acts(t, 'task.updated');
    expect(a!.metadata).toMatchObject({ field: 'description' });
    expect(a!.metadata).not.toHaveProperty('to');
  });

  it('assign/unassign: activities per user, new assignees become watchers', async () => {
    const t = await makeTeam();
    await as(t.owner.token)
      .patch(taskUrl(t, t.task.id))
      .send({ assigneeIds: [t.admin.user.id] });
    const res = await as(t.owner.token)
      .patch(taskUrl(t, t.task.id))
      .send({ assigneeIds: [t.owner.user.id] });
    expect(res.body.task.assigneeIds).toEqual([t.owner.user.id]);
    expect(res.body.task.watcherIds).toEqual(
      expect.arrayContaining([t.admin.user.id, t.owner.user.id]),
    );
    expect(
      (await acts(t, 'task.assigned')).map((a) => (a.metadata as { user: { id: string } }).user.id),
    ).toEqual([t.admin.user.id, t.owner.user.id]);
    expect(await acts(t, 'task.unassigned')).toHaveLength(1);
    expect(
      events
        .filter((e) => e.type === 'task.updated')
        .map((e) => e.type === 'task.updated' && e.assignedIds),
    ).toEqual([[t.admin.user.id], [t.owner.user.id]]);
  });

  it('a former member stays assigned while the task is edited, but can’t be newly assigned (FR-TSK-10)', async () => {
    const t = await makeTeam();
    const leaver = await addMember(t.owner.token, t.ws, 'member', 'Leaving Lisa');
    await as(t.owner.token)
      .patch(taskUrl(t, t.task.id))
      .send({ assigneeIds: [leaver.user.id] });
    await as(t.owner.token).delete(`/api/w/${t.slug}/members/${leaver.user.id}`);

    // The client re-sends the current assignees plus a new one: fine, Lisa stays.
    const res = await as(t.owner.token)
      .patch(taskUrl(t, t.task.id))
      .send({ assigneeIds: [leaver.user.id, t.member.user.id] });
    expect(res.status).toBe(200);
    expect(res.body.task.assigneeIds).toEqual([leaver.user.id, t.member.user.id]);

    // But on another task she can't be added.
    const other = await makeTask(t.owner.token, t.ws, 'MOB');
    const bad = await as(t.owner.token)
      .patch(taskUrl(t, other.id))
      .send({ assigneeIds: [leaver.user.id] });
    expect(bad.body.error.code).toBe('INVALID_ASSIGNEE');
  });

  it('protected fields in the body are ignored (mass assignment)', async () => {
    const t = await makeTeam();
    const res = await as(t.member.token)
      .patch(taskUrl(t, t.task.id))
      .send({
        title: 'Renamed',
        number: 99,
        workspaceId: String(new Types.ObjectId()),
        reporterId: t.owner.user.id,
        columnId: t.project.columns[3]!.id,
        completedAt: new Date().toISOString(),
        commentCount: 1000,
        version: 50,
      });
    expect(res.body.task).toMatchObject({
      title: 'Renamed',
      number: t.task.number,
      reporterId: t.member.user.id,
      columnId: t.project.columns[0]!.id,
      completedAt: null,
      commentCount: 0,
      version: 2,
    });
    // Only protected fields → nothing to update → 400
    expect((await as(t.member.token).patch(taskUrl(t, t.task.id)).send({ number: 5 })).status).toBe(
      400,
    );
  });

  it('expectedVersion older than the task → 409 VERSION_CONFLICT with the current task (FR-TSK-04)', async () => {
    const t = await makeTeam();
    await as(t.owner.token).patch(taskUrl(t, t.task.id)).send({ title: 'Changed by someone' });
    const res = await as(t.member.token)
      .patch(taskUrl(t, t.task.id))
      .send({ description: 'my long edit', expectedVersion: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
    expect(res.body.error.details).toMatchObject({ title: 'Changed by someone', version: 2 });
    const ok = await as(t.member.token)
      .patch(taskUrl(t, t.task.id))
      .send({ description: 'my long edit', expectedVersion: 2 });
    expect(ok.body.task.version).toBe(3);
  });

  it('a demoted member loses write access on the next request (AC-RBAC-02)', async () => {
    const t = await makeTeam();
    await as(t.owner.token)
      .patch(`/api/w/${t.slug}/members/${t.member.user.id}`)
      .send({ role: 'viewer' });
    expect(
      (await as(t.member.token).patch(taskUrl(t, t.task.id)).send({ title: 'Nope' })).status,
    ).toBe(403);
  });

  it('archived project → 409; unknown task → 404', async () => {
    const t = await makeTeam();
    await as(t.owner.token).post(`/api/w/${t.slug}/projects/MOB/archive`);
    expect((await as(t.owner.token).patch(taskUrl(t, t.task.id)).send({ title: 'x' })).status).toBe(
      409,
    );
    expect(
      (
        await as(t.owner.token)
          .patch(taskUrl(t, String(new Types.ObjectId())))
          .send({ title: 'x' })
      ).status,
    ).toBe(404);
  });
});

describe('get & delete', () => {
  it('get by number in any key case; unknown → 404', async () => {
    const t = await makeTeam();
    const res = await as(t.viewer.token).get(
      `/api/w/${t.slug}/projects/mob/tasks/${t.task.number}`,
    );
    expect(res.body.task).toMatchObject({
      id: t.task.id,
      description: '',
      reporterId: t.member.user.id,
    });
    expect((await as(t.viewer.token).get(`${tasksUrl(t)}/999`)).status).toBe(404);
    expect((await as(t.viewer.token).get(`${tasksUrl(t)}/abc`)).status).toBe(400);
  });

  it('a Member deletes only their own tasks; an Admin deletes any (FR-TSK-05)', async () => {
    const t = await makeTeam();
    const ownersTask = await makeTask(t.owner.token, t.ws, 'MOB');
    const res = await as(t.member.token).delete(taskUrl(t, ownersTask.id));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_REPORTER');

    expect((await as(t.member.token).delete(taskUrl(t, t.task.id))).status).toBe(204);
    expect((await as(t.admin.token).delete(taskUrl(t, ownersTask.id))).status).toBe(204);
    expect((await as(t.admin.token).delete(taskUrl(t, ownersTask.id))).status).toBe(404);
  });

  it('keeps a task.deleted record and never reuses the number (BR-05)', async () => {
    const t = await makeTeam();
    await as(t.member.token).delete(taskUrl(t, t.task.id));
    const [record] = await acts(t, 'task.deleted');
    expect(record!.metadata).toEqual({ task: { number: 1, title: 'Fixture task', key: 'MOB' } });
    expect((await makeTask(t.owner.token, t.ws, 'MOB')).number).toBe(2);
    expect(events).toContainEqual(expect.objectContaining({ type: 'task.deleted', number: 1 }));
  });
});

describe('my tasks (FR-TSK-11)', () => {
  it('only my open tasks in active projects, by due date with "no date" last, plus their projects', async () => {
    const t = await makeTeam();
    const me = [t.member.user.id];
    const late = await makeTask(t.owner.token, t.ws, 'MOB', {
      title: 'late',
      assigneeIds: me,
      dueDate: '2027-03-01',
    });
    const soon = await makeTask(t.owner.token, t.ws, 'MOB', {
      title: 'soon',
      assigneeIds: me,
      dueDate: '2026-12-01',
    });
    const none = await makeTask(t.owner.token, t.ws, 'MOB', { title: 'none', assigneeIds: me });
    await makeTask(t.owner.token, t.ws, 'MOB', {
      title: 'done',
      assigneeIds: me,
      columnId: t.project.columns[3]!.id,
    });
    await makeTask(t.owner.token, t.ws, 'MOB', {
      title: 'not mine',
      assigneeIds: [t.admin.user.id],
    });

    const res = await as(t.member.token).get(`/api/w/${t.slug}/my-tasks`);
    expect(res.body.tasks.map((x: TaskDto) => x.id)).toEqual([soon.id, late.id, none.id]);
    expect(res.body.projects).toEqual([{ id: t.project.id, key: 'MOB', name: 'Mobile App' }]);

    await as(t.owner.token).post(`/api/w/${t.slug}/projects/MOB/archive`);
    expect((await as(t.member.token).get(`/api/w/${t.slug}/my-tasks`)).body).toEqual({
      tasks: [],
      projects: [],
    });
  });
});
