import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import type { BoardResponse, TaskCardDto } from '@teamboard/shared';
import { Task } from '../src/db/models';
import { as } from './helpers/auth';
import { addMember, makeTask, makeTeam, type Team } from './helpers/tenants';

const oid = (id: string) => new Types.ObjectId(id);
const board = async (t: Team, query = '') =>
  (await as(t.viewer.token).get(`/api/w/${t.slug}/projects/MOB/board${query}`))
    .body as BoardResponse;

describe('GET /board (FR-BRD-10)', () => {
  it('returns project + columns + tasks + members in one call; viewers may load it', async () => {
    const t = await makeTeam();
    const b = await board(t);
    expect(b.view).toBe('all'); // "active" falls back to "all" while no sprint runs (FR-BRD-07)
    expect(b.activeSprint).toBeNull();
    expect(b.project).toMatchObject({ key: 'MOB', labels: [t.label] });
    expect(b.project.columns.map((c) => c.name)).toEqual([
      'To Do',
      'In Progress',
      'Review',
      'Done',
    ]);
    expect(b.tasks.map((x) => x.id)).toEqual([t.task.id]);
    expect(Object.keys(b.tasks[0]!).sort()).toEqual(
      [
        'assigneeIds',
        'columnId',
        'commentCount',
        'completedAt',
        'dueDate',
        'id',
        'labelIds',
        'number',
        'priority',
        'projectId',
        'rank',
        'sprintId',
        'storyPoints',
        'title',
        'version',
      ].sort(),
    ); // card fields only: no description, reporter or watchers
    expect(b.members.map((m) => m.name).sort()).toEqual(
      ['Arif Admin', 'Olivia Owner', 'Rahim Member', 'Tariq Target', 'Vera Viewer'].sort(),
    );
    expect(b.formerMembers).toEqual([]);
  });

  it('columns come in position order and tasks in rank order within each column', async () => {
    const t = await makeTeam();
    const [todo, prog] = t.project.columns;
    const a = await makeTask(t.owner.token, t.ws, 'MOB', { title: 'a', columnId: prog!.id });
    const b2 = await makeTask(t.owner.token, t.ws, 'MOB', { title: 'b', columnId: prog!.id });
    await as(t.owner.token)
      .put(`/api/w/${t.slug}/projects/MOB/columns/order`)
      .send({ columnIds: [...t.project.columns].reverse().map((c) => c.id) });

    const b = await board(t);
    expect(b.project.columns.map((c) => c.name)).toEqual([
      'Done',
      'Review',
      'In Progress',
      'To Do',
    ]);
    const inCol = (id: string) =>
      b.tasks
        .filter((x) => x.columnId === id)
        .sort((x, y) => (x.rank < y.rank ? -1 : 1))
        .map((x) => x.id);
    expect(inCol(prog!.id)).toEqual([a.id, b2.id]);
    expect(inCol(todo!.id)).toEqual([t.task.id]);
  });

  it('"all" hides tasks completed more than 14 days ago (FR-BRD-11); "backlog" = no sprint', async () => {
    const t = await makeTeam();
    const done = t.project.columns[3]!.id;
    const recent = await makeTask(t.owner.token, t.ws, 'MOB', { columnId: done });
    const old = await makeTask(t.owner.token, t.ws, 'MOB', { columnId: done });
    await Task.updateOne(
      { _id: oid(old.id), workspaceId: oid(t.ws.id) },
      { $set: { completedAt: new Date(Date.now() - 15 * 86_400_000) } },
    );

    const all = (await board(t, '?sprint=all')).tasks.map((x: TaskCardDto) => x.id);
    expect(all).toContain(recent.id);
    expect(all).not.toContain(old.id);
    const backlog = (await board(t, '?sprint=backlog')).tasks.map((x: TaskCardDto) => x.id);
    expect(backlog).toEqual(expect.arrayContaining([t.task.id, recent.id, old.id])); // nothing is in a sprint yet
  });

  it('a specific sprint id → 404 until sprints exist (Day 18); a bad value → 400', async () => {
    const t = await makeTeam();
    const res = await as(t.viewer.token).get(
      `/api/w/${t.slug}/projects/MOB/board?sprint=${new Types.ObjectId()}`,
    );
    expect(res.status).toBe(404);
    expect(
      (await as(t.viewer.token).get(`/api/w/${t.slug}/projects/MOB/board?sprint=soon`)).status,
    ).toBe(400);
  });

  it('assignees who left the workspace come back as formerMembers (FR-MEM-06c)', async () => {
    const t = await makeTeam();
    const leaver = await addMember(t.owner.token, t.ws, 'member', 'Leaving Lisa');
    await makeTask(t.owner.token, t.ws, 'MOB', { assigneeIds: [leaver.user.id] });
    await as(t.owner.token).delete(`/api/w/${t.slug}/members/${leaver.user.id}`);

    const b = await board(t);
    expect(b.members.map((m) => m.userId)).not.toContain(leaver.user.id);
    expect(b.formerMembers).toEqual([
      { userId: leaver.user.id, name: 'Leaving Lisa', avatarColor: 'blue' },
    ]);
  });

  it('a task whose column no longer exists is shown in the first column, not lost', async () => {
    const t = await makeTeam();
    await Task.updateOne(
      { _id: oid(t.task.id), workspaceId: oid(t.ws.id) },
      { $set: { columnId: new Types.ObjectId() } }, // simulate the create-vs-delete-column race
    );
    const b = await board(t);
    expect(b.tasks.find((x) => x.id === t.task.id)!.columnId).toBe(t.project.columns[0]!.id);
  });
});
