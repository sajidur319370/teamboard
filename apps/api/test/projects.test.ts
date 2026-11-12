import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS, PROJECT_KEY, suggestProjectKey } from '@teamboard/shared';
import { Activity, Project, Task } from '../src/db/models';
import { subscribe } from '../src/events/publish';
import type { DomainEvent } from '../src/events/types';
import { as } from './helpers/auth';
import { insertTask } from './helpers/tasks';
import { addMember, makeProject, makeTeam, type Team } from './helpers/tenants';

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

const url = (t: Team, path = '') => `/api/w/${t.slug}/projects${path}`;

describe('create project', () => {
  it('creates the 4 default columns with categories; the key is normalized (FR-PRJ-03)', async () => {
    const t = await makeTeam();
    const res = await as(t.admin.token).post(url(t)).send({ name: 'Web Site', key: 'web2' });
    expect(res.status).toBe(201);
    const p = res.body.project;
    expect(p.key).toBe('WEB2');
    expect(
      p.columns.map((c: { name: string; category: string; position: number }) => [
        c.name,
        c.category,
        c.position,
      ]),
    ).toEqual([
      ['To Do', 'todo', 0],
      ['In Progress', 'in_progress', 1],
      ['Review', 'in_progress', 2],
      ['Done', 'done', 3],
    ]);
    expect(p).toMatchObject({ description: '', leadId: null, labels: [], archivedAt: null });
    expect(
      await Activity.countDocuments({
        workspaceId: oid(t.ws.id),
        action: 'project.created',
        projectId: oid(p.id),
      }),
    ).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'project.changed', kind: 'created' }),
    );
  });

  it('rejects bad keys and duplicate keys (also of archived projects)', async () => {
    const t = await makeTeam();
    for (const key of ['1AB', 'A', 'TOOLONG', 'AB-C', 'ÄB']) {
      expect((await as(t.owner.token).post(url(t)).send({ name: 'X Co', key })).status, key).toBe(
        400,
      );
    }
    const dup = await as(t.owner.token).post(url(t)).send({ name: 'Other', key: 'mob' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('KEY_TAKEN');

    await as(t.owner.token).post(url(t, '/MOB/archive'));
    expect((await as(t.owner.token).post(url(t)).send({ name: 'Other', key: 'MOB' })).status).toBe(
      409,
    );
  });

  it('the lead must be a member of the workspace (FR-PRJ-01)', async () => {
    const t = await makeTeam();
    const bad = await as(t.owner.token)
      .post(url(t))
      .send({ name: 'Led', key: 'LED', leadId: t.outsider.user.id });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_LEAD');
    const ok = await as(t.owner.token)
      .post(url(t))
      .send({ name: 'Led', key: 'LED', leadId: t.member.user.id });
    expect(ok.body.project.leadId).toBe(t.member.user.id);
  });

  it(`at most ${LIMITS.projectsPerWorkspace} active projects (FR-PRJ-09)`, async () => {
    const t = await makeTeam(); // already has MOB
    await Project.insertMany(
      Array.from({ length: LIMITS.projectsPerWorkspace - 1 }, (_, i) => ({
        workspaceId: oid(t.ws.id),
        name: `Filler ${i}`,
        key: `F${i}`,
        columns: [
          { name: 'A', category: 'todo', position: 0 },
          { name: 'B', category: 'done', position: 1 },
        ],
        createdBy: oid(t.owner.user.id),
      })),
    );
    const res = await as(t.owner.token).post(url(t)).send({ name: 'One more', key: 'MORE' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_LIMIT');

    // Archive one, create one, then unarchiving would exceed the limit.
    await as(t.owner.token).post(url(t, '/MOB/archive'));
    expect(
      (await as(t.owner.token).post(url(t)).send({ name: 'One more', key: 'MORE' })).status,
    ).toBe(201);
    const un = await as(t.owner.token).post(url(t, '/MOB/unarchive'));
    expect(un.status).toBe(409);
    expect(un.body.error.code).toBe('PROJECT_LIMIT');
  });
});

describe('list, get, update', () => {
  it('lists active projects with open-task counts; ?archived=true includes archived ones', async () => {
    const t = await makeTeam();
    const web = await makeProject(t.owner.token, t.ws, 'WEB', 'Website');
    const [todo, , , done] = t.project.columns;
    await insertTask(t.ws, t.project, todo!.id, t.owner.user.id);
    await insertTask(t.ws, t.project, todo!.id, t.owner.user.id);
    await insertTask(t.ws, t.project, done!.id, t.owner.user.id, { completedAt: new Date() });
    await as(t.owner.token).post(url(t, '/WEB/archive'));

    const active = await as(t.viewer.token).get(url(t));
    expect(active.body.projects).toEqual([
      expect.objectContaining({
        key: 'MOB',
        name: 'Mobile App',
        openTasks: 2,
        activeSprint: null,
        archivedAt: null,
      }),
    ]);
    const all = await as(t.viewer.token).get(url(t, '?archived=true'));
    expect(
      all.body.projects.map((p: { key: string; archivedAt: string | null }) => [
        p.key,
        !!p.archivedAt,
      ]),
    ).toEqual([
      ['MOB', false],
      ['WEB', true],
    ]);
    void web;
  });

  it('get by key works in any letter case; unknown → 404', async () => {
    const t = await makeTeam();
    expect((await as(t.viewer.token).get(url(t, '/mob'))).body.project.id).toBe(t.project.id);
    expect((await as(t.viewer.token).get(url(t, '/NOPE'))).status).toBe(404);
  });

  it('updates name, description and lead; the key can never change (BR-05)', async () => {
    const t = await makeTeam();
    const res = await as(t.admin.token).patch(url(t, '/MOB')).send({
      name: 'Mobile v2',
      description: 'iOS + Android',
      leadId: t.member.user.id,
      key: 'NEW',
    });
    expect(res.status).toBe(200);
    expect(res.body.project).toMatchObject({
      key: 'MOB',
      name: 'Mobile v2',
      description: 'iOS + Android',
      leadId: t.member.user.id,
    });
    expect(
      (await as(t.admin.token).patch(url(t, '/MOB')).send({ leadId: null })).body.project.leadId,
    ).toBeNull();
    expect(
      (await as(t.admin.token).patch(url(t, '/MOB')).send({ leadId: t.outsider.user.id })).status,
    ).toBe(400);
  });

  it('an update that changes nothing writes no activity', async () => {
    const t = await makeTeam();
    await as(t.admin.token).patch(url(t, '/MOB')).send({ name: 'Mobile App' });
    expect(
      await Activity.countDocuments({ workspaceId: oid(t.ws.id), action: 'project.updated' }),
    ).toBe(0);
  });
});

describe('archive (FR-PRJ-06, BR-11)', () => {
  it('makes the project read-only; reading still works; unarchive restores writes', async () => {
    const t = await makeTeam();
    const arch = await as(t.admin.token).post(url(t, '/MOB/archive'));
    expect(arch.body.project.archivedAt).toEqual(expect.any(String));
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'project.changed', kind: 'archived' }),
    );

    const done = t.project.columns[3]!.id;
    for (const [method, path, body] of [
      ['patch', '/MOB', { name: 'Nope' }],
      ['post', '/MOB/columns', { name: 'QA', category: 'in_progress' }],
      ['patch', `/MOB/columns/${done}`, { name: 'Shipped' }],
      ['post', '/MOB/labels', { name: 'UX', color: 'blue' }],
    ] as const) {
      const res = await as(t.admin.token)[method](url(t, path)).send(body);
      expect(res.status, path).toBe(409);
      expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
    }
    expect((await as(t.viewer.token).get(url(t, '/MOB'))).status).toBe(200);
    expect((await as(t.viewer.token).get(url(t))).body.projects).toEqual([]); // hidden from the default list

    expect(
      (await as(t.admin.token).post(url(t, '/MOB/unarchive'))).body.project.archivedAt,
    ).toBeNull();
    expect((await as(t.admin.token).patch(url(t, '/MOB')).send({ name: 'Back' })).status).toBe(200);
  });

  it('archiving twice is a no-op (one activity)', async () => {
    const t = await makeTeam();
    await as(t.admin.token).post(url(t, '/MOB/archive'));
    await as(t.admin.token).post(url(t, '/MOB/archive'));
    expect(
      await Activity.countDocuments({ workspaceId: oid(t.ws.id), action: 'project.archived' }),
    ).toBe(1);
  });
});

describe('delete project (FR-PRJ-07)', () => {
  it('needs the key typed exactly; then cascades tasks + project activities, keeps a workspace-level record', async () => {
    const t = await makeTeam();
    const other = await makeProject(t.owner.token, t.ws, 'KEEP', 'Keep me');
    await insertTask(t.ws, t.project, t.project.columns[0]!.id, t.owner.user.id);
    const kept = await insertTask(t.ws, other, other.columns[0]!.id, t.owner.user.id);

    const wrong = await as(t.admin.token).delete(url(t, '/MOB')).send({ confirmKey: 'MO' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('CONFIRMATION_MISMATCH');

    expect(
      (await as(t.admin.token).delete(url(t, '/MOB')).send({ confirmKey: 'mob' })).status,
    ).toBe(204);
    expect((await as(t.admin.token).get(url(t, '/MOB'))).status).toBe(404);

    const ws = oid(t.ws.id);
    expect(await Task.countDocuments({ workspaceId: ws, projectId: oid(t.project.id) })).toBe(0);
    expect(await Task.countDocuments({ workspaceId: ws, _id: kept._id })).toBe(1);
    expect(await Activity.countDocuments({ workspaceId: ws, projectId: oid(t.project.id) })).toBe(
      0,
    );
    const record = await Activity.findOne({ workspaceId: ws, action: 'project.deleted' }).lean();
    expect(record).toMatchObject({ projectId: null, metadata: { name: 'Mobile App', key: 'MOB' } });
  });
});

describe('suggestProjectKey (FR-PRJ-02)', () => {
  it.each([
    ['Mobile App', 'MA'],
    ['Website', 'WEB'],
    ['Q4 Launch Plan 2', 'QLP2'],
    ['café crème', 'CC'],
    ['2026 Roadmap', 'ROA'],
    ['Extraordinarily Big Project Name With Many Words', 'EBPNWM'],
    ['x', ''],
    ['42', ''],
    ['', ''],
  ])('%s → %s', (name, key) => {
    const got = suggestProjectKey(name);
    expect(got).toBe(key);
    if (got) expect(got).toMatch(PROJECT_KEY); // every suggestion is a valid key
  });
});

describe('helpers', () => {
  it('addMember still works (sanity for the RBAC fixture)', async () => {
    const t = await makeTeam();
    const m = await addMember(t.owner.token, t.ws, 'member');
    expect((await as(m.token).get(url(t, '/MOB'))).status).toBe(200);
  });
});
