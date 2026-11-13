import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { daysBetween, todayIn, type BacklogResponse, type SprintDto } from '@teamboard/shared';
import { Activity, Notification, Sprint, Task } from '../src/db/models';
import { as } from './helpers/auth';
import { makeProject, makeSprint, makeTask, makeTeam, type Team } from './helpers/tenants';
import { connect, disconnectAll, emitAck, nextEvent, startServer } from './helpers/sockets';

// FR-SPR-01..12, data-model.md §9.1 + §12, queries.md §10, E7–E9, E18.
const w = (t: Team) => `/api/w/${t.slug}`;
const shift = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = (t: Team) => todayIn(t.ws.settings.timezone, new Date());
const col = (t: Team, category: string) => t.project.columns.find((c) => c.category === category)!;

const start = (t: Team, id: string, token = t.owner.token) =>
  as(token).post(`${w(t)}/sprints/${id}/start`);
const complete = (t: Team, id: string, carryOverTo = 'backlog') =>
  as(t.owner.token)
    .post(`${w(t)}/sprints/${id}/complete`)
    .send({ carryOverTo });
const setTasks = (
  t: Team,
  id: string,
  action: 'add' | 'remove',
  taskIds: string[],
  token = t.owner.token,
) =>
  as(token)
    .post(`${w(t)}/sprints/${id}/tasks`)
    .send({ action, taskIds });
const move = (t: Team, taskId: string, category: string) =>
  as(t.owner.token)
    .patch(`${w(t)}/tasks/${taskId}/move`)
    .send({ toColumnId: col(t, category).id, prevTaskId: null, nextTaskId: null })
    .expect(200);
const patchTask = (t: Team, id: string, body: object) =>
  as(t.owner.token)
    .patch(`${w(t)}/tasks/${id}`)
    .send(body)
    .expect(200);
const taskDoc = (t: Team, id: string) => Task.findOne({ _id: id, workspaceId: t.ws.id }).lean();
const sprintDoc = (t: Team, id: string) => Sprint.findOne({ _id: id, workspaceId: t.ws.id }).lean();

/** [action, scopeDelta, doneDelta] of a sprint's burndown events, in order. */
async function deltas(t: Team, sprintId: string) {
  const acts = await Activity.find({ workspaceId: t.ws.id, sprintId })
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  return acts.map((a) => {
    const m = a.metadata as { scopeDelta?: unknown; doneDelta?: unknown };
    return [a.action, m.scopeDelta, m.doneDelta];
  });
}
const d = (count: number, points: number) => ({ count, points });

describe('create / update / delete (FR-SPR-01, 02, 10)', () => {
  it('numbers sprints per project and names them "Sprint N" by default', async () => {
    const t = await makeTeam(); // has Sprint 1
    const s2 = await makeSprint(t.owner.token, t.ws, 'MOB', { goal: 'Ship login' });
    const named = await makeSprint(t.owner.token, t.ws, 'MOB', { name: 'Hardening' });
    expect([t.sprint, s2, named].map((s) => [s.number, s.name])).toEqual([
      [1, 'Sprint 1'],
      [2, 'Sprint 2'],
      [3, 'Hardening'],
    ]);
    expect(s2).toMatchObject({
      state: 'planned',
      goal: 'Ship login',
      scope: null,
      startedAt: null,
    });
    await makeProject(t.owner.token, t.ws, 'OTH');
    expect((await makeSprint(t.owner.token, t.ws, 'OTH')).name).toBe('Sprint 1');
  });

  it.each([
    ['end before start', { startDate: '2026-11-10', endDate: '2026-11-09' }],
    ['same day', { startDate: '2026-11-10', endDate: '2026-11-10' }],
    ['29 days', { startDate: '2026-11-01', endDate: '2026-11-30' }],
    ['not a date', { startDate: '2026-02-30', endDate: '2026-03-05' }],
    ['goal too long', { startDate: '2026-11-01', endDate: '2026-11-05', goal: 'x'.repeat(501) }],
  ])('400 for %s', async (_name, body) => {
    const t = await makeTeam();
    const res = await as(t.owner.token)
      .post(`${w(t)}/projects/MOB/sprints`)
      .send(body);
    expect(res.status).toBe(400);
  });

  it('a 28-day sprint is fine', async () => {
    const t = await makeTeam();
    const s = await makeSprint(t.owner.token, t.ws, 'MOB', {
      startDate: '2026-11-01',
      endDate: '2026-11-29',
    });
    expect(daysBetween(s.startDate, s.endDate)).toBe(28);
  });

  it('edit: planned → anything; the merged date range is checked', async () => {
    const t = await makeTeam(); // 2026-11-02 → 2026-11-13
    const ok = await as(t.owner.token)
      .patch(`${w(t)}/sprints/${t.sprint.id}`)
      .send({ name: 'Renamed', endDate: '2026-11-20' });
    expect(ok.body.sprint).toMatchObject({ name: 'Renamed', endDate: '2026-11-20' });
    // Only the end date sent, but 40 days after the stored start → 400
    const bad = await as(t.owner.token)
      .patch(`${w(t)}/sprints/${t.sprint.id}`)
      .send({ endDate: '2026-12-12' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_DATES');
  });

  it('edit: active → name, goal, end date only; completed → read-only', async () => {
    const t = await makeTeam();
    await start(t, t.sprint.id).expect(200);
    const p = (body: object) =>
      as(t.owner.token)
        .patch(`${w(t)}/sprints/${t.sprint.id}`)
        .send(body);
    expect((await p({ goal: 'Focus' })).status).toBe(200);
    const moveStart = await p({ startDate: '2026-11-01' });
    expect([moveStart.status, moveStart.body.error.code]).toEqual([409, 'INVALID_SPRINT_STATE']);
    await complete(t, t.sprint.id).expect(200);
    expect((await p({ name: 'Too late' })).status).toBe(409);
  });

  it('delete: planned only, its tasks go back to the backlog (FR-SPR-10)', async () => {
    const t = await makeTeam();
    await setTasks(t, t.sprint.id, 'add', [t.task.id]).expect(200);
    await as(t.owner.token)
      .delete(`${w(t)}/sprints/${t.sprint.id}`)
      .expect(204);
    expect((await taskDoc(t, t.task.id))!.sprintId).toBeNull();
    expect(await sprintDoc(t, t.sprint.id)).toBeNull();
    const a = await Activity.findOne({ workspaceId: t.ws.id, action: 'sprint.deleted' }).lean();
    expect(a!.metadata).toEqual({ sprint: { name: 'Sprint 1', number: 1 } });

    const s2 = await makeSprint(t.owner.token, t.ws, 'MOB');
    await start(t, s2.id).expect(200);
    const res = await as(t.owner.token).delete(`${w(t)}/sprints/${s2.id}`);
    expect([res.status, res.body.error.code]).toEqual([409, 'INVALID_SPRINT_STATE']);
  });

  it('archived projects: no sprint changes', async () => {
    const t = await makeTeam();
    await as(t.owner.token)
      .post(`${w(t)}/projects/MOB/archive`)
      .expect(200);
    const tries = await Promise.all([
      as(t.owner.token)
        .post(`${w(t)}/projects/MOB/sprints`)
        .send({ startDate: '2026-11-02', endDate: '2026-11-05' }),
      start(t, t.sprint.id),
      as(t.owner.token)
        .patch(`${w(t)}/sprints/${t.sprint.id}`)
        .send({ name: 'x' }),
      setTasks(t, t.sprint.id, 'add', [t.task.id]),
      as(t.owner.token).delete(`${w(t)}/sprints/${t.sprint.id}`),
    ]);
    expect(tries.map((r) => r.body.error?.code)).toEqual(Array(5).fill('PROJECT_ARCHIVED'));
  });
});

describe('start (FR-SPR-05, 06, E18)', () => {
  it('only one sprint can be active per project, even in a race', async () => {
    const t = await makeTeam();
    const more = await Promise.all([1, 2, 3, 4].map(() => makeSprint(t.owner.token, t.ws, 'MOB')));
    const ids = [t.sprint.id, ...more.map((s) => s.id)];
    const starts = await Promise.all(ids.map((id) => start(t, id)));
    expect(starts.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    expect(starts.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual(
      Array(4).fill('ACTIVE_SPRINT_EXISTS'),
    );
    expect(await Sprint.countDocuments({ workspaceId: t.ws.id, state: 'active' })).toBe(1);
  });

  it('snapshots tasks, points and already-done work (D4); a future start becomes today', async () => {
    const t = await makeTeam();
    const future = await makeSprint(t.owner.token, t.ws, 'MOB', {
      startDate: shift(today(t), 3),
      endDate: shift(today(t), 10),
    });
    const a = await makeTask(t.owner.token, t.ws, 'MOB', { storyPoints: 3 });
    const b = await makeTask(t.owner.token, t.ws, 'MOB', { storyPoints: 5 });
    const c = await makeTask(t.owner.token, t.ws, 'MOB'); // no estimate
    await setTasks(t, future.id, 'add', [a.id, b.id, c.id]).expect(200);
    await move(t, b.id, 'done'); // done before the start

    const res = await start(t, future.id).expect(200);
    expect(res.body.sprint).toMatchObject({
      state: 'active',
      startDate: today(t),
      endDate: shift(today(t), 10),
      scope: { totalTasks: 3, totalPoints: 8, doneTasks: 1, donePoints: 5 },
    });
    const snap = (await sprintDoc(t, future.id))!.scopeSnapshot!;
    expect(snap.taskIds.map(String).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it('a past start date stays; starting with zero tasks is allowed; started twice → 409', async () => {
    const t = await makeTeam();
    const res = await start(t, t.sprint.id).expect(200);
    expect(res.body.sprint.startDate).toBe('2026-11-02');
    expect(res.body.sprint.scope).toEqual({
      totalTasks: 0,
      totalPoints: 0,
      doneTasks: 0,
      donePoints: 0,
    });
    expect((await start(t, t.sprint.id)).status).toBe(409);
  });
});

describe('scope changes (FR-SPR-04, 07)', () => {
  it('a Member plans (planned sprint 200) but cannot change a running one (403)', async () => {
    const t = await makeTeam();
    const ok = await setTasks(t, t.sprint.id, 'add', [t.task.id], t.member.token);
    expect(ok.body).toEqual({ taskIds: [t.task.id] });
    await start(t, t.sprint.id).expect(200);
    const extra = await makeTask(t.member.token, t.ws, 'MOB');
    const denied = await setTasks(t, t.sprint.id, 'add', [extra.id], t.member.token);
    expect(denied.status).toBe(403);
    const removeDenied = await setTasks(t, t.sprint.id, 'remove', [t.task.id], t.member.token);
    expect(removeDenied.status).toBe(403);
    expect(
      await setTasks(t, t.sprint.id, 'add', [extra.id], t.admin.token).then((r) => r.status),
    ).toBe(200);
  });

  it('done tasks and other projects’ tasks are skipped, not added', async () => {
    const t = await makeTeam();
    const done = await makeTask(t.owner.token, t.ws, 'MOB', { columnId: col(t, 'done').id });
    await makeProject(t.owner.token, t.ws, 'OTH');
    const foreign = await makeTask(t.owner.token, t.ws, 'OTH');
    const res = await setTasks(t, t.sprint.id, 'add', [t.task.id, done.id, foreign.id]).expect(200);
    expect(res.body.taskIds).toEqual([t.task.id]);
    expect((await taskDoc(t, done.id))!.sprintId).toBeNull();
    expect((await taskDoc(t, foreign.id))!.sprintId).toBeNull();
  });

  it('BR-09: a task leaves the ACTIVE sprint explicitly before joining another', async () => {
    const t = await makeTeam();
    await setTasks(t, t.sprint.id, 'add', [t.task.id]).expect(200);
    await start(t, t.sprint.id).expect(200);
    const next = await makeSprint(t.owner.token, t.ws, 'MOB');
    const res = await setTasks(t, next.id, 'add', [t.task.id]);
    expect([res.status, res.body.error.code]).toEqual([409, 'TASK_IN_ACTIVE_SPRINT']);
    // From one PLANNED sprint to another is just re-planning
    const p2 = await makeSprint(t.owner.token, t.ws, 'MOB');
    const other = await makeTask(t.owner.token, t.ws, 'MOB');
    await setTasks(t, next.id, 'add', [other.id]).expect(200);
    await setTasks(t, p2.id, 'add', [other.id]).expect(200);
    expect(String((await taskDoc(t, other.id))!.sprintId)).toBe(p2.id);
  });

  it('a task can be created straight into a sprint; other projects’ sprints are refused', async () => {
    const t = await makeTeam();
    const task = await makeTask(t.owner.token, t.ws, 'MOB', { sprintId: t.sprint.id });
    expect(task.sprintId).toBe(t.sprint.id);
    await makeProject(t.owner.token, t.ws, 'OTH');
    const res = await as(t.owner.token)
      .post(`${w(t)}/projects/OTH/tasks`)
      .send({ title: 'x', sprintId: t.sprint.id });
    expect([res.status, res.body.error.code]).toEqual([400, 'INVALID_SPRINT']);
  });
});

describe('burndown deltas (data-model.md §12: all 7 rows)', () => {
  it('every change to the running sprint writes its effect', async () => {
    const t = await makeTeam();
    const s = t.sprint.id;
    const a = await makeTask(t.owner.token, t.ws, 'MOB', { title: 'A', storyPoints: 3 });
    const b = await makeTask(t.owner.token, t.ws, 'MOB', { title: 'B', storyPoints: 5 });
    await setTasks(t, s, 'add', [a.id, b.id]).expect(200);
    await move(t, b.id, 'done'); // done BEFORE the start: no event (planned sprint)
    await start(t, s).expect(200);

    await move(t, a.id, 'done'); // row 4: completed
    await move(t, a.id, 'todo'); // row 5: reopened (E7)
    const c = await makeTask(t.owner.token, t.ws, 'MOB', { title: 'C', storyPoints: 2 });
    await setTasks(t, s, 'add', [c.id]).expect(200); // row 1: added, not done
    await patchTask(t, c.id, { storyPoints: 8 }); // row 6: points change, not done (D6)
    await move(t, c.id, 'done'); // completed with the NEW points
    await patchTask(t, c.id, { storyPoints: 13 }); // row 7: points change, done
    await setTasks(t, s, 'remove', [b.id]).expect(200); // row 3: removed, done
    await setTasks(t, s, 'remove', [a.id]).expect(200); // row 2: removed, not done
    await as(t.owner.token)
      .delete(`${w(t)}/tasks/${c.id}`)
      .expect(204); // D9: deleted, done
    const created = await makeTask(t.owner.token, t.ws, 'MOB', {
      title: 'D',
      storyPoints: 1,
      sprintId: s,
    });

    expect(await deltas(t, s)).toEqual([
      ['sprint.created', undefined, undefined],
      ['sprint.started', undefined, undefined],
      ['task.completed', d(0, 0), d(1, 3)],
      ['task.reopened', d(0, 0), d(-1, -3)],
      ['task.added_to_sprint', d(1, 2), d(0, 0)],
      ['task.updated', d(0, 6), d(0, 0)],
      ['task.completed', d(0, 0), d(1, 8)],
      ['task.updated', d(0, 5), d(0, 5)],
      ['task.removed_from_sprint', d(-1, -5), d(-1, -5)],
      ['task.removed_from_sprint', d(-1, -3), d(0, 0)],
      ['task.removed_from_sprint', d(-1, -13), d(-1, -13)],
      ['task.added_to_sprint', d(1, 1), d(0, 0)],
    ]);
    expect(created.sprintId).toBe(s);
  });

  it('a column turning into / out of "done" writes deltas for the sprint’s tasks in it', async () => {
    const t = await makeTeam();
    const review = t.project.columns.find((c) => c.category === 'in_progress')!;
    const x = await makeTask(t.owner.token, t.ws, 'MOB', { storyPoints: 2, columnId: review.id });
    const outside = await makeTask(t.owner.token, t.ws, 'MOB', {
      storyPoints: 5,
      columnId: review.id,
    });
    await setTasks(t, t.sprint.id, 'add', [x.id]).expect(200);
    await start(t, t.sprint.id).expect(200);
    const patchCol = (category: string) =>
      as(t.owner.token)
        .patch(`${w(t)}/projects/MOB/columns/${review.id}`)
        .send({ category })
        .expect(200);
    await patchCol('done');
    await patchCol('in_progress');
    expect((await deltas(t, t.sprint.id)).slice(2)).toEqual([
      ['task.completed', d(0, 0), d(1, 2)],
      ['task.reopened', d(0, 0), d(-1, -2)],
    ]);
    // The task outside the sprint got its completion events, without a sprint
    const plain = await Activity.find({
      workspaceId: t.ws.id,
      taskId: outside.id,
      action: 'task.completed',
    }).lean();
    expect(plain).toHaveLength(1);
    expect(plain[0]!.sprintId).toBeNull();
    expect(plain[0]!.metadata).not.toHaveProperty('doneDelta');
  });

  it('tasks of a PLANNED sprint never write deltas', async () => {
    const t = await makeTeam();
    await setTasks(t, t.sprint.id, 'add', [t.task.id]).expect(200);
    await move(t, t.task.id, 'done');
    await patchTask(t, t.task.id, { storyPoints: 5 });
    expect(await deltas(t, t.sprint.id)).toEqual([['sprint.created', undefined, undefined]]);
  });
});

describe('the touch lock (D10): races never lose a burndown event', () => {
  // For every task that ends up in the sprint: it's in the start snapshot, OR its add was
  // recorded as an event. For every deleted one in the snapshot: its removal was recorded.
  it('adding tasks while the sprint starts', async () => {
    for (let round = 0; round < 2; round++) {
      const t = await makeTeam();
      const tasks = await Promise.all(
        [1, 2, 3].map((n) => makeTask(t.owner.token, t.ws, 'MOB', { storyPoints: n })),
      );
      const [, ...adds] = await Promise.all([
        start(t, t.sprint.id, t.admin.token),
        ...tasks.map((x) => setTasks(t, t.sprint.id, 'add', [x.id], t.admin.token)),
      ]);
      expect(adds.every((r) => r.status === 200)).toBe(true);
      const snap = (await sprintDoc(t, t.sprint.id))!.scopeSnapshot!.taskIds.map(String);
      const added = await Activity.distinct('taskId', {
        workspaceId: t.ws.id,
        sprintId: t.sprint.id,
        action: 'task.added_to_sprint',
      });
      const recorded = new Set([...snap, ...added.map(String)]);
      for (const x of tasks) expect(recorded.has(x.id), `round ${round}`).toBe(true);
      // ...and nothing counted twice
      expect(snap.filter((id) => added.map(String).includes(id))).toEqual([]);
    }
  });

  it('deleting tasks while the sprint starts', async () => {
    for (let round = 0; round < 2; round++) {
      const t = await makeTeam();
      const tasks = await Promise.all([1, 2].map(() => makeTask(t.owner.token, t.ws, 'MOB')));
      await setTasks(
        t,
        t.sprint.id,
        'add',
        tasks.map((x) => x.id),
      ).expect(200);
      const [started, ...deletes] = await Promise.all([
        start(t, t.sprint.id),
        ...tasks.map((x) => as(t.owner.token).delete(`${w(t)}/tasks/${x.id}`)),
      ]);
      expect(started.status).toBe(200);
      expect(deletes.map((r) => r.status)).toEqual([204, 204]);
      const snap = (await sprintDoc(t, t.sprint.id))!.scopeSnapshot!.taskIds.map(String);
      const removed = (
        await Activity.distinct('taskId', {
          workspaceId: t.ws.id,
          sprintId: t.sprint.id,
          action: 'task.removed_from_sprint',
        })
      ).map(String);
      expect(
        snap.filter((id) => !removed.includes(id)),
        `round ${round}`,
      ).toEqual([]);
    }
  });
});

/**
 * Deterministic version of the races above. A transaction reads the sprint's tasks (what a
 * start does), THEN another request commits, THEN the transaction writes the sprint. If that
 * request touched the sprint, the write must fail with a write conflict (the driver would
 * retry the start and see the change). If it didn't, the start would commit a stale
 * snapshot: exactly the lost-burndown-event bug the lock exists for.
 */
async function startConflictsWith(t: Team, sprintId: string, act: () => Promise<unknown>) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });
    await Task.find({ workspaceId: t.ws.id, sprintId }).session(session).lean(); // snapshot taken
    await act(); // commits in between
    const write = Sprint.updateOne(
      { _id: sprintId, workspaceId: t.ws.id },
      { $inc: { lock: 1 } },
      { session },
    );
    return await write.then(
      () => false,
      (err: { errorLabels?: string[]; codeName?: string }) =>
        err.codeName === 'WriteConflict' ||
        !!err.errorLabels?.includes('TransientTransactionError'),
    );
  } finally {
    if (session.inTransaction()) await session.abortTransaction();
    await session.endSession();
  }
}

describe('the touch lock, deterministically', () => {
  it('adding a task to the sprint conflicts with a start in progress', async () => {
    const t = await makeTeam();
    expect(
      await startConflictsWith(t, t.sprint.id, () =>
        setTasks(t, t.sprint.id, 'add', [t.task.id]).expect(200),
      ),
    ).toBe(true);
  });

  it('removing one, deleting one, or creating one into the sprint does too', async () => {
    const t = await makeTeam();
    const [a, b] = await Promise.all([1, 2].map(() => makeTask(t.owner.token, t.ws, 'MOB')));
    await setTasks(t, t.sprint.id, 'add', [a!.id, b!.id]).expect(200);
    expect(
      await startConflictsWith(t, t.sprint.id, () =>
        setTasks(t, t.sprint.id, 'remove', [a!.id]).expect(200),
      ),
    ).toBe(true);
    expect(
      await startConflictsWith(t, t.sprint.id, () =>
        as(t.owner.token)
          .delete(`${w(t)}/tasks/${b!.id}`)
          .expect(204),
      ),
    ).toBe(true);
    expect(
      await startConflictsWith(t, t.sprint.id, () =>
        makeTask(t.owner.token, t.ws, 'MOB', { sprintId: t.sprint.id }),
      ),
    ).toBe(true);
  });

  it('completing a sprint task conflicts with a start/complete in progress', async () => {
    const t = await makeTeam();
    await setTasks(t, t.sprint.id, 'add', [t.task.id]).expect(200);
    await start(t, t.sprint.id).expect(200);
    expect(await startConflictsWith(t, t.sprint.id, () => move(t, t.task.id, 'done'))).toBe(true);
  });

  it('control: an unrelated write does NOT conflict (the test can tell the difference)', async () => {
    const t = await makeTeam();
    expect(
      await startConflictsWith(t, t.sprint.id, () =>
        patchTask(t, t.task.id, { title: 'unrelated' }),
      ),
    ).toBe(false);
  });
});

describe('complete (FR-SPR-08)', () => {
  it('done work stays; unfinished work goes to the backlog', async () => {
    const t = await makeTeam();
    const done = await makeTask(t.owner.token, t.ws, 'MOB');
    await setTasks(t, t.sprint.id, 'add', [t.task.id, done.id]).expect(200);
    await start(t, t.sprint.id).expect(200);
    await move(t, done.id, 'done');
    const res = await complete(t, t.sprint.id).expect(200);
    expect(res.body).toMatchObject({ sprint: { state: 'completed' }, carriedOver: 1 });
    expect(res.body.sprint.completedAt).toEqual(expect.any(String));
    expect((await taskDoc(t, t.task.id))!.sprintId).toBeNull();
    expect(String((await taskDoc(t, done.id))!.sprintId)).toBe(t.sprint.id);
    const a = await Activity.findOne({ workspaceId: t.ws.id, action: 'sprint.completed' }).lean();
    expect(a!.metadata).toMatchObject({ completedTasks: 1, carriedOverTasks: 1 });
    expect((await complete(t, t.sprint.id)).status).toBe(409); // once only
  });

  it('…or into a chosen planned sprint of the same project', async () => {
    const t = await makeTeam();
    const next = await makeSprint(t.owner.token, t.ws, 'MOB');
    await setTasks(t, t.sprint.id, 'add', [t.task.id]).expect(200);
    await start(t, t.sprint.id).expect(200);
    await makeProject(t.owner.token, t.ws, 'OTH');
    const foreign = await makeSprint(t.owner.token, t.ws, 'OTH');
    for (const bad of [t.sprint.id, foreign.id, String(new Types.ObjectId())]) {
      expect((await complete(t, t.sprint.id, bad)).status, bad).toBe(400);
    }
    await complete(t, t.sprint.id, next.id).expect(200);
    expect(String((await taskDoc(t, t.task.id))!.sprintId)).toBe(next.id);
  });

  it('only the active sprint can be completed', async () => {
    const t = await makeTeam();
    const res = await complete(t, t.sprint.id);
    expect([res.status, res.body.error.code]).toEqual([409, 'INVALID_SPRINT_STATE']);
  });
});

describe('views', () => {
  it('board: ?sprint=active shows the running sprint, or falls back to all (FR-BRD-07)', async () => {
    const t = await makeTeam();
    const board = (q: string) =>
      as(t.member.token)
        .get(`${w(t)}/projects/MOB/board?sprint=${q}`)
        .expect(200);
    let b = await board('active');
    expect([b.body.view, b.body.activeSprint]).toEqual(['all', null]);

    const other = await makeTask(t.owner.token, t.ws, 'MOB');
    await setTasks(t, t.sprint.id, 'add', [t.task.id]).expect(200);
    await start(t, t.sprint.id).expect(200);
    b = await board('active');
    expect(b.body.view).toBe('active');
    expect(b.body.activeSprint).toMatchObject({ id: t.sprint.id, name: 'Sprint 1', number: 1 });
    expect(b.body.tasks.map((x: { id: string }) => x.id)).toEqual([t.task.id]);
    expect((await board('backlog')).body.tasks.map((x: { id: string }) => x.id)).toEqual([
      other.id,
    ]);
    const byId = await board(t.sprint.id);
    expect(byId.body.view).toBe(t.sprint.id);
    await makeProject(t.owner.token, t.ws, 'OTH');
    const foreign = await makeSprint(t.owner.token, t.ws, 'OTH');
    await as(t.member.token)
      .get(`${w(t)}/projects/MOB/board?sprint=${foreign.id}`)
      .expect(404);
  });

  it('backlog: active, then planned by start date, each with its OPEN tasks by priority', async () => {
    const t = await makeTeam(); // Sprint 1 starts 2026-11-02
    const early = await makeSprint(t.owner.token, t.ws, 'MOB', {
      startDate: '2026-10-01',
      endDate: '2026-10-10',
    });
    const low = await makeTask(t.owner.token, t.ws, 'MOB', { priority: 'low' });
    const urgent = await makeTask(t.owner.token, t.ws, 'MOB', { priority: 'urgent' });
    const doneInSprint = await makeTask(t.owner.token, t.ws, 'MOB', {
      columnId: col(t, 'done').id,
    });
    await setTasks(t, t.sprint.id, 'add', [low.id]).expect(200);
    await Task.updateOne(
      { _id: doneInSprint.id, workspaceId: t.ws.id },
      { $set: { sprintId: t.sprint.id } },
    );
    await start(t, t.sprint.id).expect(200);

    const res = await as(t.viewer.token)
      .get(`${w(t)}/projects/MOB/backlog`)
      .expect(200);
    const body = res.body as BacklogResponse;
    expect(body.sprints.map((s) => [s.sprint.id, s.sprint.state])).toEqual([
      [t.sprint.id, 'active'],
      [early.id, 'planned'],
    ]);
    expect(body.sprints[0]!.tasks.map((x) => x.id)).toEqual([low.id]); // done work hidden
    expect(body.backlog.map((x) => x.id)).toEqual([urgent.id, t.task.id]); // urgent first
  });

  it('lists sprints: active, planned by start, completed newest first', async () => {
    const t = await makeTeam();
    const a = await makeSprint(t.owner.token, t.ws, 'MOB', {
      startDate: '2026-10-01',
      endDate: '2026-10-10',
    });
    const b = await makeSprint(t.owner.token, t.ws, 'MOB', {
      startDate: '2026-12-01',
      endDate: '2026-12-10',
    });
    await start(t, a.id).expect(200);
    await complete(t, a.id).expect(200);
    await start(t, t.sprint.id).expect(200);
    const res = await as(t.viewer.token)
      .get(`${w(t)}/projects/MOB/sprints`)
      .expect(200);
    expect(res.body.sprints.map((s: SprintDto) => [s.id, s.state])).toEqual([
      [t.sprint.id, 'active'],
      [b.id, 'planned'],
      [a.id, 'completed'],
    ]);
    const done = await as(t.viewer.token).get(`${w(t)}/projects/MOB/sprints?state=completed`);
    expect(done.body.sprints.map((s: SprintDto) => s.id)).toEqual([a.id]);
  });

  it('the project list names the running sprint (queries.md §5.2); project delete removes sprints', async () => {
    const t = await makeTeam();
    await start(t, t.sprint.id).expect(200);
    const list = await as(t.member.token)
      .get(`${w(t)}/projects`)
      .expect(200);
    expect(list.body.projects[0].activeSprint).toEqual({ id: t.sprint.id, name: 'Sprint 1' });
    await as(t.owner.token)
      .delete(`${w(t)}/projects/MOB`)
      .send({ confirmKey: 'MOB' })
      .expect(204);
    expect(await Sprint.countDocuments({ workspaceId: t.ws.id })).toBe(0);
  });
});

describe('N9 + live', () => {
  let srv: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    srv = await startServer();
  });
  afterEach(() => disconnectAll());
  afterAll(async () => {
    await srv.close();
  });

  it('start/complete notify the assignees of the sprint’s tasks (N9)', async () => {
    const t = await makeTeam();
    await patchTask(t, t.task.id, { assigneeIds: [t.member.user.id, t.owner.user.id] });
    await setTasks(t, t.sprint.id, 'add', [t.task.id]).expect(200);
    await start(t, t.sprint.id).expect(200);
    await complete(t, t.sprint.id).expect(200);
    const got = await Notification.find({
      workspaceId: t.ws.id,
      userId: t.member.user.id,
      type: /^sprint\./,
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    expect(got.map((n) => [n.type, n.data])).toEqual([
      ['sprint.started', { sprintName: 'Sprint 1', projectKey: 'MOB' }],
      ['sprint.completed', { sprintName: 'Sprint 1', projectKey: 'MOB' }],
    ]);
    expect(
      await Notification.countDocuments({
        workspaceId: t.ws.id,
        userId: t.owner.user.id,
        type: /^sprint\./,
      }),
    ).toBe(0); // the actor
  });

  it('the board room hears sprint:* and tasks:sprintChanged', async () => {
    const t = await makeTeam();
    const s = await connect(srv.port, t.viewer.token);
    await emitAck(s, 'workspace:join', { workspaceId: t.ws.id });
    await emitAck(s, 'board:join', { projectId: t.project.id });

    const changed = nextEvent<{ taskIds: string[]; sprintId: string | null }>(
      s,
      'tasks:sprintChanged',
    );
    await setTasks(t, t.sprint.id, 'add', [t.task.id]).expect(200);
    expect(await changed).toMatchObject({ taskIds: [t.task.id], sprintId: t.sprint.id });

    const started = nextEvent<{ sprint: SprintDto }>(s, 'sprint:started');
    await start(t, t.sprint.id).expect(200);
    expect((await started).sprint).toMatchObject({ id: t.sprint.id, state: 'active' });

    const carried = nextEvent<{ taskIds: string[]; sprintId: string | null }>(
      s,
      'tasks:sprintChanged',
    );
    const completed = nextEvent<{ sprint: SprintDto }>(s, 'sprint:completed');
    await complete(t, t.sprint.id).expect(200);
    expect((await completed).sprint.state).toBe('completed');
    expect(await carried).toMatchObject({ taskIds: [t.task.id], sprintId: null });
  });
});
