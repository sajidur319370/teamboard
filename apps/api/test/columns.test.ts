import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS, type ColumnDto } from '@teamboard/shared';
import { Activity, Project, Task } from '../src/db/models';
import { tenantBulkWrite } from '../src/db/tenantBulkWrite';
import { subscribe } from '../src/events/publish';
import type { DomainEvent } from '../src/events/types';
import { makeCtx } from '../src/types/ctx';
import { as } from './helpers/auth';
import { insertTask, tasksIn } from './helpers/tasks';
import { makeTeam, twoTenants, type Team } from './helpers/tenants';

const oid = (id: string) => new Types.ObjectId(id);
const cols = (t: Team, path = '') => `/api/w/${t.slug}/projects/MOB/columns${path}`;
const byName = (columns: ColumnDto[], name: string) => columns.find((c) => c.name === name)!;

let events: DomainEvent[];
let off: () => void;
beforeEach(() => {
  events = [];
  off = subscribe((_ctx, e) => {
    events.push(e);
  });
});
afterEach(() => off());

describe('add & reorder columns', () => {
  it('appends a column; publishes the full list; logs column.created', async () => {
    const t = await makeTeam();
    const res = await as(t.admin.token).post(cols(t)).send({ name: 'QA', category: 'in_progress' });
    expect(res.status).toBe(201);
    expect(res.body.columns.map((c: ColumnDto) => [c.name, c.position])).toEqual([
      ['To Do', 0],
      ['In Progress', 1],
      ['Review', 2],
      ['Done', 3],
      ['QA', 4],
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'columns.changed',
        kind: 'created',
        columns: res.body.columns,
      }),
    );
    expect(
      await Activity.countDocuments({ workspaceId: oid(t.ws.id), action: 'column.created' }),
    ).toBe(1);
  });

  it(`the ${LIMITS.columnsPerProject + 1}th column → 409 COLUMN_LIMIT; duplicate names in any case → 409`, async () => {
    const t = await makeTeam();
    const dup = await as(t.admin.token).post(cols(t)).send({ name: 'review', category: 'todo' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('COLUMN_NAME_TAKEN');

    for (let i = 4; i < LIMITS.columnsPerProject; i++) {
      expect(
        (
          await as(t.admin.token)
            .post(cols(t))
            .send({ name: `C${i}`, category: 'todo' })
        ).status,
      ).toBe(201);
    }
    const over = await as(t.admin.token)
      .post(cols(t))
      .send({ name: 'One too many', category: 'todo' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('COLUMN_LIMIT');
  });

  it('reorder: an exact permutation rewrites positions 0..n-1; anything else → 400 INVALID_ORDER', async () => {
    const t = await makeTeam();
    const ids = t.project.columns.map((c) => c.id);
    const reversed = [...ids].reverse();
    const ok = await as(t.admin.token).put(cols(t, '/order')).send({ columnIds: reversed });
    expect(ok.status).toBe(200);
    expect(ok.body.columns.map((c: ColumnDto) => c.id)).toEqual(reversed);
    expect(ok.body.columns.map((c: ColumnDto) => c.position)).toEqual([0, 1, 2, 3]);

    for (const columnIds of [
      ids.slice(0, 3), // missing one
      [ids[0], ids[0], ids[1], ids[2]], // duplicate
      [...ids.slice(0, 3), String(new Types.ObjectId())], // a foreign id
    ]) {
      const res = await as(t.admin.token).put(cols(t, '/order')).send({ columnIds });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ORDER');
    }
  });
});

describe('rename & category', () => {
  it('rename logs column.renamed; renaming onto another name → 409', async () => {
    const t = await makeTeam();
    const done = byName(t.project.columns, 'Done');
    const res = await as(t.admin.token)
      .patch(cols(t, `/${done.id}`))
      .send({ name: 'Shipped' });
    expect(byName(res.body.columns, 'Shipped').category).toBe('done'); // the name is cosmetic (BR-07)
    const act = await Activity.findOne({
      workspaceId: oid(t.ws.id),
      action: 'column.renamed',
    }).lean();
    expect(act!.metadata).toEqual({ from: 'Done', to: 'Shipped' });

    const clash = await as(t.admin.token)
      .patch(cols(t, `/${done.id}`))
      .send({ name: 'to do' });
    expect(clash.body.error.code).toBe('COLUMN_NAME_TAKEN');
  });

  it("can't delete or re-categorize the last done column, or make every column done (E16, I10)", async () => {
    const t = await makeTeam();
    const done = byName(t.project.columns, 'Done');
    const del = await as(t.owner.token)
      .delete(cols(t, `/${done.id}`))
      .send({});
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('BOARD_INVARIANT');
    const upd = await as(t.owner.token)
      .patch(cols(t, `/${done.id}`))
      .send({ category: 'todo' });
    expect(upd.body.error.code).toBe('BOARD_INVARIANT');

    const [todo, prog, review] = t.project.columns;
    await as(t.owner.token)
      .patch(cols(t, `/${todo!.id}`))
      .send({ category: 'done' });
    await as(t.owner.token)
      .patch(cols(t, `/${prog!.id}`))
      .send({ category: 'done' });
    const last = await as(t.owner.token)
      .patch(cols(t, `/${review!.id}`))
      .send({ category: 'done' });
    expect(last.body.error.code).toBe('BOARD_INVARIANT');
  });

  it('moving a column INTO done completes its tasks; OUT of done reopens them (FR-BRD-06)', async () => {
    const t = await makeTeam();
    const review = byName(t.project.columns, 'Review');
    const a = await insertTask(t.ws, t.project, review.id, t.owner.user.id);
    const b = await insertTask(t.ws, t.project, review.id, t.owner.user.id);

    await as(t.admin.token)
      .patch(cols(t, `/${review.id}`))
      .send({ category: 'done' });
    let tasks = await tasksIn(t.ws, t.project, review.id);
    expect(tasks.every((x) => x.completedAt instanceof Date)).toBe(true);
    expect(tasks.map((x) => x.version)).toEqual([2, 2]);
    const completed = await Activity.find({
      workspaceId: oid(t.ws.id),
      action: 'task.completed',
    }).lean();
    expect(completed.map((x) => String(x.taskId)).sort()).toEqual(
      [String(a._id), String(b._id)].sort(),
    );

    await as(t.admin.token)
      .patch(cols(t, `/${review.id}`))
      .send({ category: 'in_progress' });
    tasks = await tasksIn(t.ws, t.project, review.id);
    expect(tasks.every((x) => x.completedAt === null)).toBe(true);
    expect(
      await Activity.countDocuments({ workspaceId: oid(t.ws.id), action: 'task.reopened' }),
    ).toBe(2);
  });

  it('in_progress → todo changes no task', async () => {
    const t = await makeTeam();
    const review = byName(t.project.columns, 'Review');
    await insertTask(t.ws, t.project, review.id, t.owner.user.id);
    await as(t.admin.token)
      .patch(cols(t, `/${review.id}`))
      .send({ category: 'todo' });
    expect((await tasksIn(t.ws, t.project, review.id))[0]!.version).toBe(1);
  });

  it('two admins re-categorizing the two done columns at once: one wins, the board keeps a done column', async () => {
    const t = await makeTeam();
    const added = await as(t.owner.token)
      .post(cols(t))
      .send({ name: 'Released', category: 'done' });
    const [done1, done2] = (added.body.columns as ColumnDto[]).filter((c) => c.category === 'done');

    const results = await Promise.all([
      as(t.owner.token)
        .patch(cols(t, `/${done1!.id}`))
        .send({ category: 'todo' }),
      as(t.admin.token)
        .patch(cols(t, `/${done2!.id}`))
        .send({ category: 'todo' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(['RETRY', 'BOARD_INVARIANT']).toContain(
      results.find((r) => r.status === 409)!.body.error.code,
    );

    const p = await Project.findOne({ _id: oid(t.project.id), workspaceId: oid(t.ws.id) }).lean();
    expect(p!.columns.filter((c) => c.category === 'done')).toHaveLength(1);
  });
});

describe('delete column (FR-BRD-04)', () => {
  it('an empty column just goes; positions close the gap', async () => {
    const t = await makeTeam();
    const review = byName(t.project.columns, 'Review');
    const res = await as(t.admin.token)
      .delete(cols(t, `/${review.id}`))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.columns.map((c: ColumnDto) => [c.name, c.position])).toEqual([
      ['To Do', 0],
      ['In Progress', 1],
      ['Done', 2],
    ]);
  });

  it('with tasks: a target is required; tasks go to the BOTTOM of the target in their order', async () => {
    const t = await makeTeam();
    const prog = byName(t.project.columns, 'In Progress');
    const done = byName(t.project.columns, 'Done');
    const existing = await insertTask(t.ws, t.project, done.id, t.owner.user.id, {
      completedAt: new Date(),
    });
    const m1 = await insertTask(t.ws, t.project, prog.id, t.owner.user.id, { title: 'first' });
    const m2 = await insertTask(t.ws, t.project, prog.id, t.owner.user.id, { title: 'second' });

    const noTarget = await as(t.admin.token)
      .delete(cols(t, `/${prog.id}`))
      .send({});
    expect(noTarget.status).toBe(400);
    expect(noTarget.body.error.code).toBe('TARGET_REQUIRED');
    const self = await as(t.admin.token)
      .delete(cols(t, `/${prog.id}`))
      .send({ targetColumnId: prog.id });
    expect(self.status).toBe(400);
    const foreign = await as(t.admin.token)
      .delete(cols(t, `/${prog.id}`))
      .send({ targetColumnId: String(new Types.ObjectId()) });
    expect(foreign.body.error.code).toBe('INVALID_COLUMN');

    const res = await as(t.admin.token)
      .delete(cols(t, `/${prog.id}`))
      .send({ targetColumnId: done.id });
    expect(res.status).toBe(200);
    const inDone = await tasksIn(t.ws, t.project, done.id);
    expect(inDone.map((x) => String(x._id))).toEqual([existing._id, m1._id, m2._id].map(String));
    expect(inDone.every((x) => x.completedAt instanceof Date)).toBe(true); // moved into done
    expect(
      await Activity.countDocuments({ workspaceId: oid(t.ws.id), action: 'task.completed' }),
    ).toBe(2);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'columns.changed',
        kind: 'deleted',
        movedTaskIds: [String(m1._id), String(m2._id)],
      }),
    );
  });
});

describe('labels (FR-PRJ-08)', () => {
  const labels = (t: Team, path = '') => `/api/w/${t.slug}/projects/MOB/labels${path}`;

  it('add, rename/recolor, duplicate names (any case) → 409', async () => {
    const t = await makeTeam(); // already has "Bug"
    const add = await as(t.admin.token).post(labels(t)).send({ name: 'UX', color: 'purple' });
    expect(add.status).toBe(201);
    expect(add.body.labels.map((l: { name: string }) => l.name)).toEqual(['Bug', 'UX']);
    const dup = await as(t.admin.token).post(labels(t)).send({ name: 'bug', color: 'gray' });
    expect(dup.body.error.code).toBe('LABEL_NAME_TAKEN');

    const upd = await as(t.admin.token)
      .patch(labels(t, `/${t.label.id}`))
      .send({ name: 'Defect', color: 'orange' });
    expect(upd.body.labels[0]).toEqual({ id: t.label.id, name: 'Defect', color: 'orange' });
    expect(
      (await as(t.admin.token).post(labels(t)).send({ name: 'x', color: 'neon' })).status,
    ).toBe(400);
  });

  it(`at most ${LIMITS.labelsPerProject} labels`, async () => {
    const t = await makeTeam();
    for (let i = 1; i < LIMITS.labelsPerProject; i++) {
      await as(t.admin.token)
        .post(labels(t))
        .send({ name: `L${i}`, color: 'blue' });
    }
    const res = await as(t.admin.token).post(labels(t)).send({ name: 'Extra', color: 'blue' });
    expect(res.body.error.code).toBe('LABEL_LIMIT');
  });

  it('deleting a label also removes it from every task that had it', async () => {
    const t = await makeTeam();
    const task = await insertTask(t.ws, t.project, t.project.columns[0]!.id, t.owner.user.id, {
      labelIds: [t.label.id],
    });
    const res = await as(t.admin.token).delete(labels(t, `/${t.label.id}`));
    expect(res.body.labels).toEqual([]);
    const after = await Task.findOne({ _id: task._id, workspaceId: oid(t.ws.id) }).lean();
    expect(after!.labelIds).toEqual([]);
    expect(after!.version).toBe(2);
  });
});

describe('IDOR: my own project + another tenant’s column / label id → 404', () => {
  it('columns and labels are looked up INSIDE my project', async () => {
    const t = await twoTenants();
    const mine = `/api/w/${t.a.ws.slug}/projects/${t.a.project.key}`;
    const bCol = t.b.project.columns[0]!.id;
    const alice = as(t.a.token);
    expect((await alice.patch(`${mine}/columns/${bCol}`).send({ name: 'x' })).status).toBe(404);
    expect((await alice.delete(`${mine}/columns/${bCol}`).send({})).status).toBe(404);
    expect((await alice.patch(`${mine}/labels/${t.b.label.id}`).send({ name: 'x' })).status).toBe(
      404,
    );
    expect((await alice.delete(`${mine}/labels/${t.b.label.id}`)).status).toBe(404);
    // ...and B's column can't be used as a delete target either
    const res = await alice
      .delete(`${mine}/columns/${t.a.project.columns[1]!.id}`)
      .send({ targetColumnId: bCol });
    expect(res.status).toBe(400);
  });
});

describe('tenantBulkWrite', () => {
  it('forces ctx.workspaceId into every filter, even if the caller passed another one', async () => {
    const t = await twoTenants();
    const bTask = await insertTask(t.b.ws, t.b.project, t.b.project.columns[0]!.id, t.b.user.id);
    const ctxA = makeCtx({
      userId: oid(t.a.user.id),
      workspaceId: oid(t.a.ws.id),
      role: 'owner',
      tz: 'UTC',
    });

    const res = await tenantBulkWrite(ctxA, Task, [
      {
        updateOne: {
          filter: { _id: bTask._id, workspaceId: oid(t.b.ws.id) }, // trying to aim at B
          update: { $set: { title: 'pwned' } },
        },
      },
    ]);
    expect(res?.modifiedCount).toBe(0);
    const after = await Task.findOne({ _id: bTask._id, workspaceId: oid(t.b.ws.id) }).lean();
    expect(after!.title).not.toBe('pwned');
  });
});
