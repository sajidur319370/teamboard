import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import type { ActivityDto, Page } from '@teamboard/shared';
import { Activity } from '../src/db/models';
import { as } from './helpers/auth';
import { makeComment, makeProject, makeTask, makeTeam, type Team } from './helpers/tenants';

// FR-ACT-06/07, queries.md §11: newest first, cursor on (createdAt, _id), filters.
const feed = async (t: Team, query = '', token = t.viewer.token) => {
  const res = await as(token).get(`/api/w/${t.slug}/activities${query ? `?${query}` : ''}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Page<ActivityDto>;
};

/** Walk every page; returns the ids in order and the number of pages. */
async function readAll(t: Team, query: string) {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page: Page<ActivityDto> = await feed(t, `${query}${cursor ? `&cursor=${cursor}` : ''}`);
    ids.push(...page.items.map((a) => a.id));
    cursor = page.nextCursor;
    pages++;
  } while (cursor && pages < 50);
  return { ids, pages };
}

/** Insert n activities on t.task, many sharing a millisecond (ties only _id can order). */
async function seed(t: Team, n: number) {
  const base = Date.UTC(2026, 0, 5, 10);
  return Activity.insertMany(
    Array.from({ length: n }, (_, i) => ({
      workspaceId: t.ws.id,
      projectId: t.project.id,
      taskId: t.task.id,
      actorId: t.member.user.id,
      action: 'task.updated',
      entityType: 'task',
      entityId: t.task.id,
      metadata: { task: { key: 'MOB', number: 1, title: 'x' }, field: 'priority' },
      createdAt: new Date(base + Math.floor(i / 3)), // 3 per millisecond
    })),
  );
}

describe('feeds', () => {
  it('task feed: newest first, every row exactly once across pages, ties included', async () => {
    const t = await makeTeam();
    await Activity.deleteMany({ workspaceId: t.ws.id, taskId: t.task.id });
    const docs = await seed(t, 70);
    const expected = docs
      .map((d) => ({ id: String(d._id), t: d.createdAt.getTime() }))
      .sort((a, b) => b.t - a.t || b.id.localeCompare(a.id))
      .map((d) => d.id);

    const { ids, pages } = await readAll(t, `taskId=${t.task.id}&limit=7`);
    expect(ids).toEqual(expected);
    expect(pages).toBe(10);
  });

  it('defaults to 30 per page', async () => {
    const t = await makeTeam();
    await seed(t, 40);
    const page = await feed(t, `taskId=${t.task.id}`);
    expect(page.items).toHaveLength(30);
    expect(page.nextCursor).toEqual(expect.any(String));
  });

  it('a new activity arriving between "Load more" clicks never shifts the next page', async () => {
    const t = await makeTeam();
    await Activity.deleteMany({ workspaceId: t.ws.id, taskId: t.task.id });
    await seed(t, 10);
    const first = await feed(t, `taskId=${t.task.id}&limit=4`);
    await makeComment(t.member.token, t.ws, t.task.id, 'new!'); // newest: lands BEFORE page 1
    const second = await feed(t, `taskId=${t.task.id}&limit=4&cursor=${first.nextCursor}`);
    const all = [...first.items, ...second.items].map((a) => a.id);
    expect(new Set(all).size).toBe(8); // no repeats (skip() would repeat the 4th row)
    expect(second.items.every((a) => a.action === 'task.updated')).toBe(true);
  });

  it('scopes: task ⊂ project ⊂ workspace', async () => {
    const t = await makeTeam();
    const other = await makeProject(t.owner.token, t.ws, 'OTH');
    const otherTask = await makeTask(t.owner.token, t.ws, 'OTH');

    const task = await feed(t, `taskId=${t.task.id}&limit=100`);
    expect(task.items.map((a) => a.action).sort()).toEqual(['comment.created', 'task.created']);
    expect(task.items.every((a) => a.taskId === t.task.id)).toBe(true);

    const project = await feed(t, `projectId=${t.project.id}&limit=100`);
    expect(project.items.every((a) => a.projectId === t.project.id)).toBe(true);
    expect(project.items.map((a) => a.action)).toContain('project.created');

    const ws = await feed(t, 'limit=100');
    const actions = ws.items.map((a) => a.action);
    expect(actions).toContain('workspace.created'); // no project: only in the workspace feed
    expect(ws.items.some((a) => a.projectId === other.id)).toBe(true);
    expect(ws.items.some((a) => a.taskId === otherTask.id)).toBe(true);
    expect(ws.items.length).toBeGreaterThan(project.items.length);
  });

  it('filters by actor and by action group (FR-ACT-07)', async () => {
    const t = await makeTeam();
    const mine = await feed(t, `actorId=${t.member.user.id}&limit=100`);
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((a) => a.actor.id === t.member.user.id)).toBe(true);
    expect(mine.items[0]!.actor).toMatchObject({ name: 'Rahim Member' });

    const members = await feed(t, 'group=members&limit=100');
    expect(new Set(members.items.map((a) => a.action))).toEqual(
      new Set(['invite.created', 'member.joined']),
    );
    const comments = await feed(t, 'group=comments');
    expect(comments.items.map((a) => a.action)).toEqual(['comment.created']);
    expect(comments.items[0]!.metadata).toMatchObject({ excerpt: 'Fixture comment' });
  });

  it('rejects bad queries with 400, never 500', async () => {
    const t = await makeTeam();
    for (const q of [
      'group=fun',
      'limit=0',
      'limit=101',
      'taskId=nope',
      'cursor=%7B%7D',
      'cursor=bm9wZQ',
    ]) {
      const res = await as(t.viewer.token).get(`/api/w/${t.slug}/activities?${q}`);
      expect(res.status, q).toBe(400);
    }
  });

  it("a deleted actor renders as 'Former user'", async () => {
    const t = await makeTeam();
    await Activity.insertMany([
      {
        workspaceId: t.ws.id,
        actorId: new Types.ObjectId(),
        action: 'member.left',
        entityType: 'membership',
        entityId: t.ws.id,
        metadata: { role: 'member' },
      },
    ]);
    const page = await feed(t, 'limit=1');
    expect(page.items[0]).toMatchObject({
      action: 'member.left',
      actor: { name: 'Former user', avatarColor: 'gray' },
      projectId: null,
      taskId: null,
    });
  });

  it('history survives the task: the deleted task is still named in its feed', async () => {
    const t = await makeTeam();
    await as(t.member.token).delete(`/api/w/${t.slug}/tasks/${t.task.id}`).expect(204);
    const page = await feed(t, `taskId=${t.task.id}`);
    expect(page.items[0]).toMatchObject({
      action: 'task.deleted',
      metadata: { task: { key: 'MOB', title: 'Fixture task' } },
    });
  });
});
