import { beforeEach, describe, expect, it } from 'vitest';
import { listRoutes } from '../src/lib/routeRegistry';
import { tenantRouter } from '../src/tenantRouter';
import { PASSWORD, as } from './helpers/auth';
import { twoTenants } from './helpers/tenants';

type T = Awaited<ReturnType<typeof twoTenants>>;
type Probe = {
  /** The route exactly as the router declares it, e.g. 'PATCH /members/:userId' */
  route: string;
  /** A VALID body, so a foreign-id request reaches the service instead of stopping at 400 */
  body?: (t: T) => object;
};

/**
 * Alice (owner of workspace A) attacks workspace B. Each probe runs twice:
 *  1. foreign slug:  /api/w/<B>/...            with B's ids  → 404 (not a member of B)
 *  2. foreign id:    /api/w/<A>/...<B's id>    (routes with :params only) → 404 (IDOR)
 * THIS LIST GROWS EVERY DAY. The coverage test fails if a route has no probe.
 */
const PROBES: Probe[] = [
  { route: 'GET /' },
  { route: 'PATCH /', body: () => ({ name: 'pwned' }) },
  { route: 'DELETE /', body: () => ({ confirmName: 'B Corp' }) },
  { route: 'POST /leave' },
  {
    route: 'POST /transfer-ownership',
    body: (t) => ({ userId: t.b.member.user.id, password: PASSWORD }),
  },
  { route: 'GET /members' },
  { route: 'PATCH /members/:userId', body: () => ({ role: 'viewer' }) },
  { route: 'DELETE /members/:userId' },
  { route: 'GET /invites' },
  { route: 'POST /invites', body: () => ({ role: 'viewer' }) },
  { route: 'DELETE /invites/:inviteId' },
  // Day 8: projects, columns, labels
  { route: 'GET /projects' },
  { route: 'POST /projects', body: () => ({ name: 'Pwned', key: 'PWN' }) },
  { route: 'GET /projects/:key' },
  { route: 'PATCH /projects/:key', body: () => ({ name: 'pwned' }) },
  { route: 'POST /projects/:key/archive' },
  { route: 'POST /projects/:key/unarchive' },
  { route: 'DELETE /projects/:key', body: (t) => ({ confirmKey: t.b.project.key }) },
  { route: 'POST /projects/:key/columns', body: () => ({ name: 'Pwned', category: 'todo' }) },
  {
    route: 'PUT /projects/:key/columns/order',
    body: (t) => ({ columnIds: [...t.b.project.columns].reverse().map((c) => c.id) }),
  },
  { route: 'PATCH /projects/:key/columns/:columnId', body: () => ({ name: 'pwned' }) },
  { route: 'DELETE /projects/:key/columns/:columnId' },
  { route: 'POST /projects/:key/labels', body: () => ({ name: 'Pwned', color: 'red' }) },
  { route: 'PATCH /projects/:key/labels/:labelId', body: () => ({ name: 'pwned' }) },
  { route: 'DELETE /projects/:key/labels/:labelId' },
  // Day 9: board, tasks, my tasks
  { route: 'GET /projects/:key/board' },
  { route: 'POST /projects/:key/tasks', body: () => ({ title: 'pwned' }) },
  { route: 'GET /projects/:key/tasks/:number' },
  { route: 'PATCH /tasks/:taskId', body: () => ({ title: 'pwned' }) },
  {
    route: 'PATCH /tasks/:taskId/move',
    body: (t) => ({ toColumnId: t.b.project.columns[1]!.id, prevTaskId: null, nextTaskId: null }),
  },
  { route: 'DELETE /tasks/:taskId' },
  { route: 'GET /my-tasks' },
  // Day 16: comments, activity feeds
  { route: 'GET /tasks/:taskId/comments' },
  { route: 'POST /tasks/:taskId/comments', body: () => ({ body: 'pwned' }) },
  { route: 'PATCH /comments/:commentId', body: () => ({ body: 'pwned' }) },
  { route: 'DELETE /comments/:commentId' },
  { route: 'GET /activities' },
  // Day 17: notifications
  { route: 'GET /notifications' },
  { route: 'GET /notifications/unread-count' },
  { route: 'POST /notifications/read-all' },
  { route: 'POST /notifications/:notificationId/read' },
  // Day 18: sprints
  { route: 'GET /projects/:key/sprints' },
  {
    route: 'POST /projects/:key/sprints',
    body: () => ({ startDate: '2026-11-02', endDate: '2026-11-13' }),
  },
  { route: 'GET /projects/:key/backlog' },
  { route: 'PATCH /sprints/:sprintId', body: () => ({ name: 'pwned' }) },
  { route: 'DELETE /sprints/:sprintId' },
  { route: 'POST /sprints/:sprintId/start' },
  { route: 'POST /sprints/:sprintId/complete', body: () => ({ carryOverTo: 'backlog' }) },
  {
    route: 'POST /sprints/:sprintId/tasks',
    body: (t) => ({ action: 'add', taskIds: [t.b.task.id] }),
  },
];

/** Path params → B's ids. Add an entry when a route gets a new :param. */
const B_IDS: Record<string, (t: T) => string> = {
  userId: (t) => t.b.member.user.id,
  inviteId: (t) => t.b.inviteId,
  key: (t) => t.b.project.key,
  columnId: (t) => t.b.project.columns[0]!.id,
  labelId: (t) => t.b.label.id,
  taskId: (t) => t.b.task.id,
  number: (t) => String(t.b.task.number),
  commentId: (t) => t.b.comment.id,
  notificationId: (t) => t.b.notificationId,
  sprintId: (t) => t.b.sprint.id,
};

function request(t: T, probe: Probe, slug: string) {
  const [method, path] = probe.route.split(' ') as [string, string];
  const filled = path.replace(/:(\w+)/g, (_, name: string) => {
    const pick = B_IDS[name];
    if (!pick) throw new Error(`No B fixture for ":${name}". Add it to B_IDS.`);
    return pick(t);
  });
  const url = `/api/w/${slug}${filled === '/' ? '' : filled}`;
  const client = as(t.a.token);
  const m = method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
  return client[m](url).send(probe.body?.(t) ?? {});
}

const hasParams = (p: Probe) => p.route.includes(':');

describe('cross-tenant isolation', () => {
  let t: T;
  beforeEach(async () => {
    t = await twoTenants();
  });

  it.each(PROBES)('foreign slug: $route → 404', async (probe) => {
    const res = await request(t, probe, t.b.ws.slug);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each(PROBES.filter(hasParams))(
    'foreign id in my own workspace: $route → 404',
    async (probe) => {
      const res = await request(t, probe, t.a.ws.slug);
      expect(res.status).toBe(404);
    },
  );

  it("B's data is untouched after every probe", async () => {
    for (const probe of PROBES) {
      await request(t, probe, t.b.ws.slug);
      if (hasParams(probe)) await request(t, probe, t.a.ws.slug);
    }
    const bob = as(t.b.token);
    const ws = await bob.get(`/api/w/${t.b.ws.slug}`);
    expect(ws.body).toMatchObject({ workspace: { name: 'B Corp' }, role: 'owner' });
    const members = await bob.get(`/api/w/${t.b.ws.slug}/members`);
    expect(
      members.body.members.map((m: { name: string; role: string }) => [m.name, m.role]),
    ).toEqual([
      ['B Corp member', 'member'],
      ['Bob', 'owner'],
    ]);
    const invites = await bob.get(`/api/w/${t.b.ws.slug}/invites`);
    expect(invites.body.invites.map((i: { id: string }) => i.id)).toEqual([t.b.inviteId]);
    const project = await bob.get(`/api/w/${t.b.ws.slug}/projects/${t.b.project.key}`);
    // Same columns, name and label as created (makeProject ran before the label was added).
    expect(project.body.project).toEqual({ ...t.b.project, labels: [t.b.label] });
    const projects = await bob.get(`/api/w/${t.b.ws.slug}/projects`);
    expect(projects.body.projects.map((p: { key: string }) => p.key)).toEqual(['BEE']);
    const task = await bob.get(`/api/w/${t.b.ws.slug}/projects/BEE/tasks/${t.b.task.number}`);
    expect(task.body.task).toMatchObject({ id: t.b.task.id, title: 'B Corp task', version: 1 });
    const board = await bob.get(`/api/w/${t.b.ws.slug}/projects/BEE/board`);
    expect(board.body.tasks.map((x: { id: string }) => x.id)).toEqual([t.b.task.id]);
    expect(board.body.tasks[0].commentCount).toBe(1);
    const comments = await bob.get(`/api/w/${t.b.ws.slug}/tasks/${t.b.task.id}/comments`);
    expect(comments.body.items).toEqual([t.b.comment]); // not edited, not deleted, no new ones
    const unread = await bob.get(`/api/w/${t.b.ws.slug}/notifications/unread-count`);
    expect(unread.body.count).toBeGreaterThan(0); // Alice's read-all / read didn't touch Bob's
    const sprints = await bob.get(`/api/w/${t.b.ws.slug}/projects/BEE/sprints`);
    expect(sprints.body.sprints).toEqual([t.b.sprint]); // not renamed, started or deleted
    expect(board.body.tasks[0].sprintId).toBeNull(); // not pulled into a sprint
  });

  it("a feed filtered by B's ids, in A's workspace, is empty (filters can't widen the tenant)", async () => {
    const alice = as(t.a.token);
    for (const q of [
      `taskId=${t.b.task.id}`,
      `projectId=${t.b.project.id}`,
      `actorId=${t.b.user.id}`,
    ]) {
      const res = await alice.get(`/api/w/${t.a.ws.slug}/activities?${q}`);
      expect(res.status, q).toBe(200);
      expect(res.body, q).toEqual({ items: [], nextCursor: null });
    }
  });

  it("A's lists never contain B's data", async () => {
    const alice = as(t.a.token);
    const me = await alice.get('/api/me');
    expect(me.body.workspaces.map((w: { slug: string }) => w.slug)).toEqual([t.a.ws.slug]);

    const members = await alice.get(`/api/w/${t.a.ws.slug}/members`);
    const memberIds = members.body.members.map((m: { userId: string }) => m.userId);
    expect(memberIds).toHaveLength(2);
    expect(memberIds).not.toContain(t.b.user.id);
    expect(memberIds).not.toContain(t.b.member.user.id);

    const invites = await alice.get(`/api/w/${t.a.ws.slug}/invites`);
    expect(invites.body.invites.map((i: { id: string }) => i.id)).toEqual([t.a.inviteId]);

    const projects = await alice.get(`/api/w/${t.a.ws.slug}/projects?archived=true`);
    expect(projects.body.projects.map((p: { key: string }) => p.key)).toEqual(['AAA']);
  });
});

describe('cross-tenant coverage (TR-03)', () => {
  it('every tenant-scoped route has a probe, and every probe matches a real route', () => {
    const routes = listRoutes(tenantRouter).map((r) => `${r.method} ${r.path}`);
    expect([...new Set(PROBES.map((p) => p.route))].sort()).toEqual([...new Set(routes)].sort());
  });
});
