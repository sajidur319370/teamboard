import { describe, expect, it } from 'vitest';
import type {
  BurndownResponse,
  MembersReportResponse,
  SummaryReportResponse,
} from '@teamboard/shared';
import { Activity, Sprint } from '../src/db/models';
import { buildSprintReport } from '../src/modules/reports/report.service';
import { makeCtx } from '../src/types/ctx';
import { oid } from '../src/lib/ids';
import { as } from './helpers/auth';
import { makeTask, makeTeam, type Team } from './helpers/tenants';

// FR-RPT-01..08, AC-RPT-02/03.
const w = (t: Team) => `/api/w/${t.slug}`;
const col = (t: Team, category: string) => t.project.columns.find((c) => c.category === category)!;
const report = async <T>(t: Team, sprintId: string, part: string, token = t.viewer.token) => {
  const res = await as(token).get(`${w(t)}/sprints/${sprintId}/reports/${part}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as T;
};
const move = (t: Team, taskId: string, category: string) =>
  as(t.owner.token)
    .patch(`${w(t)}/tasks/${taskId}/move`)
    .send({ toColumnId: col(t, category).id, prevTaskId: null, nextTaskId: null })
    .expect(200);

/** A started sprint with: A (3 pts, member), B (5 pts, member + admin), C (no estimate). */
async function running() {
  const t = await makeTeam();
  const mk = (title: string, body: object) =>
    makeTask(t.owner.token, t.ws, 'MOB', { title, ...body });
  const a = await mk('A', { storyPoints: 3, assigneeIds: [t.member.user.id] });
  const b = await mk('B', { storyPoints: 5, assigneeIds: [t.member.user.id, t.admin.user.id] });
  const c = await mk('C', {});
  await as(t.owner.token)
    .post(`${w(t)}/sprints/${t.sprint.id}/tasks`)
    .send({ action: 'add', taskIds: [a.id, b.id, c.id] })
    .expect(200);
  await as(t.owner.token)
    .post(`${w(t)}/sprints/${t.sprint.id}/start`)
    .expect(200);
  return { t, a, b, c };
}

describe('timezone buckets (AC-RPT-02)', () => {
  // A completion at 19:30 UTC on Oct 20 is already Oct 21 in Dhaka (UTC+6).
  async function setup() {
    const t = await makeTeam();
    const ws = oid(t.ws.id);
    const sprintId = oid(t.sprint.id);
    await Sprint.updateOne(
      { _id: sprintId, workspaceId: ws },
      {
        $set: {
          state: 'active',
          startDate: '2026-10-19',
          endDate: '2026-10-28',
          startedAt: new Date('2026-10-19T03:00:00Z'),
          scopeSnapshot: {
            taskIds: [],
            totalTasks: 10,
            totalPoints: 30,
            doneTasks: 0,
            donePoints: 0,
            takenAt: new Date('2026-10-19T03:00:00Z'),
          },
        },
      },
    );
    await Activity.insertMany([
      {
        workspaceId: ws,
        projectId: oid(t.project.id),
        taskId: oid(t.task.id),
        sprintId,
        actorId: oid(t.owner.user.id),
        action: 'task.completed',
        entityType: 'task',
        entityId: oid(t.task.id),
        metadata: { scopeDelta: { count: 0, points: 0 }, doneDelta: { count: 1, points: 3 } },
        createdAt: new Date('2026-10-20T19:30:00Z'),
      },
    ]);
    const sprint = (await Sprint.findOne({ _id: sprintId, workspaceId: ws }).lean())!;
    const ctxIn = (tz: string) =>
      makeCtx({
        userId: oid(t.owner.user.id),
        workspaceId: ws,
        role: 'owner',
        tz,
        now: () => new Date('2026-10-24T12:00:00Z'),
      });
    return { sprint, ctxIn };
  }
  const remainingOn = (r: Awaited<ReturnType<typeof buildSprintReport>>, day: string) =>
    r.burndown.find((p) => p.day === day)!.remainingPoints;

  it('Asia/Dhaka: the event lands on Oct 21', async () => {
    const { sprint, ctxIn } = await setup();
    const r = await buildSprintReport(ctxIn('Asia/Dhaka'), sprint);
    expect([remainingOn(r, '2026-10-20'), remainingOn(r, '2026-10-21')]).toEqual([30, 27]);
    expect(r.timezone).toBe('Asia/Dhaka');
  });

  it('UTC: the same event lands on Oct 20', async () => {
    const { sprint, ctxIn } = await setup();
    const r = await buildSprintReport(ctxIn('UTC'), sprint);
    expect([remainingOn(r, '2026-10-20'), remainingOn(r, '2026-10-21')]).toEqual([27, 27]);
  });
});

describe('live reports of the running sprint', () => {
  it('burndown: today reflects the work so far; points by default; unestimated counted', async () => {
    const { t, a } = await running();
    await move(t, a.id, 'done');
    const r = await report<BurndownResponse>(t, t.sprint.id, 'burndown');
    expect(r).toMatchObject({ unit: 'points', unestimated: 1, frozenAt: null });
    const todayPoint = r.points.filter((p) => p.remainingPoints !== null).at(-1)!;
    expect(todayPoint).toMatchObject({
      scopePoints: 8,
      remainingPoints: 5,
      scopeTasks: 3,
      remainingTasks: 2,
    });
    const forced = await report<BurndownResponse>(t, t.sprint.id, 'burndown?unit=count');
    expect(forced.unit).toBe('count');
  });

  it('a sprint with no estimates defaults to count (FR-RPT-03)', async () => {
    const t = await makeTeam();
    await as(t.owner.token)
      .post(`${w(t)}/sprints/${t.sprint.id}/tasks`)
      .send({ action: 'add', taskIds: [t.task.id] })
      .expect(200);
    await as(t.owner.token)
      .post(`${w(t)}/sprints/${t.sprint.id}/start`)
      .expect(200);
    expect((await report<BurndownResponse>(t, t.sprint.id, 'burndown')).unit).toBe('count');
  });

  it('members: each assignee counts the task; Unassigned last; points then tasks', async () => {
    const { t, a, b, c } = await running();
    // The biggest bucket is unassigned: it must STILL come last.
    const big = await makeTask(t.owner.token, t.ws, 'MOB', {
      storyPoints: 21,
      sprintId: t.sprint.id,
    });
    for (const x of [a, b, c, big]) await move(t, x.id, 'done');
    const { members } = await report<MembersReportResponse>(t, t.sprint.id, 'members');
    expect(members.map((m) => [m.name, m.tasks, m.points, m.isFormer])).toEqual([
      ['Rahim Member', 2, 8, false],
      ['Arif Admin', 1, 5, false],
      ['Unassigned', 2, 21, false],
    ]);
    expect(members.at(-1)!.userId).toBeNull();
  });

  it('a removed assignee is tagged as former, not hidden', async () => {
    const { t, a } = await running();
    await move(t, a.id, 'done');
    await as(t.owner.token)
      .delete(`${w(t)}/members/${t.member.user.id}`)
      .expect(204);
    const { members } = await report<MembersReportResponse>(t, t.sprint.id, 'members');
    expect(members[0]).toMatchObject({ name: 'Rahim Member', isFormer: true, tasks: 1 });
  });

  it('summary: committed, added, removed, completed, carried over, completion %', async () => {
    const { t, a, c } = await running();
    const d = await makeTask(t.owner.token, t.ws, 'MOB', { storyPoints: 2 });
    const add = (action: string, taskIds: string[]) =>
      as(t.owner.token)
        .post(`${w(t)}/sprints/${t.sprint.id}/tasks`)
        .send({ action, taskIds })
        .expect(200);
    await add('add', [d.id]);
    await add('remove', [c.id]);
    await move(t, a.id, 'done');
    const { summary } = await report<SummaryReportResponse>(t, t.sprint.id, 'summary');
    expect(summary).toEqual({
      committedTasks: 3,
      committedPoints: 8,
      addedTasks: 1,
      addedPoints: 2,
      removedTasks: 1,
      removedPoints: 0,
      completedTasks: 1,
      completedPoints: 3,
      carriedOverTasks: 2, // B, D: still open
      carriedOverPoints: 7,
      completionPct: { tasks: 33.3, points: 30 }, // 1/3 tasks, 3/10 points
    });
  });

  it('a planned sprint has no report yet (409); another tenant’s or unknown id → 404', async () => {
    const t = await makeTeam();
    const res = await as(t.viewer.token).get(`${w(t)}/sprints/${t.sprint.id}/reports/burndown`);
    expect([res.status, res.body.error.code]).toEqual([409, 'SPRINT_NOT_STARTED']);
    const other = await makeTeam();
    await as(t.viewer.token)
      .get(`${w(t)}/sprints/${other.sprint.id}/reports/summary`)
      .expect(404);
  });
});

describe('frozen on completion (FR-RPT-07, AC-RPT-03)', () => {
  it('the report is computed BEFORE carry-over and never changes afterwards', async () => {
    const { t, a, b } = await running();
    await move(t, a.id, 'done');
    await as(t.owner.token)
      .post(`${w(t)}/sprints/${t.sprint.id}/complete`)
      .send({ carryOverTo: 'backlog' })
      .expect(200);

    const read = async () => ({
      burndown: await report<BurndownResponse>(t, t.sprint.id, 'burndown'),
      members: await report<MembersReportResponse>(t, t.sprint.id, 'members'),
      summary: await report<SummaryReportResponse>(t, t.sprint.id, 'summary'),
    });
    const before = await read();
    expect(before.summary.frozenAt).toEqual(expect.any(String));
    expect(before.summary.summary).toMatchObject({
      completedTasks: 1,
      completedPoints: 3,
      carriedOverTasks: 2, // B and C were still in the sprint when it froze
      carriedOverPoints: 5,
    });
    expect(before.members.members.map((m) => m.name)).toEqual(['Rahim Member']);

    // Change history-relevant things afterwards: reopen A, re-estimate it, reassign it,
    // finish B (now in the backlog), rename the workspace timezone.
    await as(t.owner.token)
      .patch(`${w(t)}/tasks/${a.id}`)
      .send({ storyPoints: 13, assigneeIds: [t.admin.user.id] })
      .expect(200);
    await move(t, a.id, 'todo');
    await move(t, b.id, 'done');
    await as(t.owner.token).patch(w(t)).send({ timezone: 'Asia/Tokyo' }).expect(200);

    expect(await read()).toEqual(before);
  });
});
