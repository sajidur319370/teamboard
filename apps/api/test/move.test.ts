import mongoose, { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TaskDto } from '@teamboard/shared';
import { Activity, Task } from '../src/db/models';
import { subscribe } from '../src/events/publish';
import type { DomainEvent } from '../src/events/types';
import { rebalanceColumn } from '../src/modules/tasks/move.service';
import { makeCtx } from '../src/types/ctx';
import { as } from './helpers/auth';
import { move, readBoard } from './helpers/board';
import { makeProject, makeTask, makeTeam, twoTenants, type Team } from './helpers/tenants';

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

/** A team with tasks a, b in column "In Progress" and x, y in "To Do". */
async function setup() {
  const t = await makeTeam();
  const [todo, prog, review, done] = t.project.columns.map((c) => c.id) as [
    string,
    string,
    string,
    string,
  ];
  const mk = (title: string, columnId: string) =>
    makeTask(t.owner.token, t.ws, 'MOB', { title, columnId });
  const a = await mk('a', prog);
  const b = await mk('b', prog);
  const x = await mk('x', todo);
  const y = await mk('y', todo);
  return { t, todo, prog, review, done, a, b, x, y };
}
const acts = (t: Team, action: 'task.moved' | 'task.completed' | 'task.reopened') =>
  Activity.countDocuments({ workspaceId: oid(t.ws.id), action });

describe('move basics', () => {
  it('moves across columns: one task.moved activity, published event, version +1', async () => {
    const { t, prog, a, b, x } = await setup();
    const res = await move(t.member.token, t.slug, x.id, {
      toColumnId: prog,
      prevTaskId: a.id,
      nextTaskId: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.noop).toBe(false);
    expect(res.body.task).toMatchObject({ id: x.id, columnId: prog, version: 2 });
    // "after a" with no next given: right after a, i.e. before b
    expect((await readBoard(t.owner.token, t.slug)).order(prog)).toEqual([a.id, x.id, b.id]);
    expect(await acts(t, 'task.moved')).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'task.moved', fromColumnId: t.project.columns[0]!.id }),
    );
  });

  it('places the card exactly between the neighbours it names', async () => {
    const { t, prog, a, b, x } = await setup();
    await move(t.owner.token, t.slug, x.id, {
      toColumnId: prog,
      prevTaskId: a.id,
      nextTaskId: b.id,
    });
    expect((await readBoard(t.owner.token, t.slug)).order(prog)).toEqual([a.id, x.id, b.id]);
    await move(t.owner.token, t.slug, b.id, {
      toColumnId: prog,
      prevTaskId: null,
      nextTaskId: a.id,
    }); // to the top
    expect((await readBoard(t.owner.token, t.slug)).order(prog)).toEqual([b.id, a.id, x.id]);
  });

  it('reordering WITHIN a column writes no task.moved activity (FR-ORD-09)', async () => {
    const { t, prog, a, b } = await setup();
    const res = await move(t.owner.token, t.slug, a.id, {
      toColumnId: prog,
      prevTaskId: b.id,
      nextTaskId: null,
    });
    expect(res.body.noop).toBe(false);
    expect((await readBoard(t.owner.token, t.slug)).order(prog)).toEqual([b.id, a.id]);
    expect(await acts(t, 'task.moved')).toBe(0);
  });

  it('dropping a card where it already is → noop, nothing written (FR-ORD-08)', async () => {
    const { t, prog, todo, a, b, x, y } = await setup();
    // a is already directly above b, and b directly below a
    const sameA = await move(t.owner.token, t.slug, a.id, {
      toColumnId: prog,
      prevTaskId: null,
      nextTaskId: b.id,
    });
    expect(sameA.body).toMatchObject({ noop: true, task: { version: 1 } });
    const sameB = await move(t.owner.token, t.slug, b.id, {
      toColumnId: prog,
      prevTaskId: a.id,
      nextTaskId: null,
    });
    expect(sameB.body).toMatchObject({ noop: true, task: { version: 1 } });
    // The only card in its column, dropped back into it: y goes alone into the empty Review
    // column (a real move), then is dropped there again (noop).
    const review = t.project.columns[2]!.id;
    await move(t.owner.token, t.slug, y.id, {
      toColumnId: review,
      prevTaskId: null,
      nextTaskId: null,
    });
    const res = await move(t.owner.token, t.slug, y.id, {
      toColumnId: review,
      prevTaskId: null,
      nextTaskId: null,
    });
    expect(res.body).toMatchObject({ noop: true, task: { version: 2 } });
    void x;
    void todo;
    expect(
      await Activity.countDocuments({
        workspaceId: oid(t.ws.id),
        taskId: oid(a.id),
        action: 'task.moved',
      }),
    ).toBe(0);
    expect(events.filter((e) => e.type === 'task.moved')).toHaveLength(1); // only y's real move
  });
});

describe('done / reopen (FR-ORD-14, BR-07)', () => {
  it('into a done column sets completedAt + task.completed; out of it clears it + task.reopened', async () => {
    const { t, done, prog, a } = await setup();
    const into = await move(t.owner.token, t.slug, a.id, {
      toColumnId: done,
      prevTaskId: null,
      nextTaskId: null,
    });
    expect(into.body.task.completedAt).toEqual(expect.any(String));
    expect(await acts(t, 'task.completed')).toBe(1);

    const out = await move(t.owner.token, t.slug, a.id, {
      toColumnId: prog,
      prevTaskId: null,
      nextTaskId: null,
    });
    expect(out.body.task.completedAt).toBeNull();
    expect(await acts(t, 'task.reopened')).toBe(1);
    expect(
      events
        .filter((e) => e.type === 'task.moved')
        .map((e) => e.type === 'task.moved' && e.intoDone),
    ).toEqual([true, false]);
  });

  it('between two in_progress columns completedAt stays null', async () => {
    const { t, review, a } = await setup();
    const res = await move(t.owner.token, t.slug, a.id, {
      toColumnId: review,
      prevTaskId: null,
      nextTaskId: null,
    });
    expect(res.body.task.completedAt).toBeNull();
    expect(await acts(t, 'task.completed')).toBe(0);
  });
});

describe('races and stale clients', () => {
  it('two drops into the same gap at once: both land between the neighbours (AC-ORD-02)', async () => {
    const { t, prog, a, b, x, y } = await setup();
    const [r1, r2] = await Promise.all([
      move(t.owner.token, t.slug, x.id, { toColumnId: prog, prevTaskId: a.id, nextTaskId: b.id }),
      move(t.member.token, t.slug, y.id, { toColumnId: prog, prevTaskId: a.id, nextTaskId: b.id }),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const view = await readBoard(t.owner.token, t.slug);
    const order = view.order(prog);
    expect(order[0]).toBe(a.id);
    expect(order.at(-1)).toBe(b.id);
    expect(order.slice(1, 3).sort()).toEqual([x.id, y.id].sort());
    expect(view.rankOf(x.id)).not.toBe(view.rankOf(y.id)); // distinct ranks (uniq_column_rank)
  });

  it('after such a race you can still drop a card BETWEEN the two racers', async () => {
    const { t, prog, todo, a, b, x, y } = await setup();
    await Promise.all([
      move(t.owner.token, t.slug, x.id, { toColumnId: prog, prevTaskId: a.id, nextTaskId: b.id }),
      move(t.owner.token, t.slug, y.id, { toColumnId: prog, prevTaskId: a.id, nextTaskId: b.id }),
    ]);
    const [first, second] = (await readBoard(t.owner.token, t.slug)).order(prog).slice(1, 3) as [
      string,
      string,
    ];
    const z = await makeTask(t.owner.token, t.ws, 'MOB', { title: 'z', columnId: todo });
    await move(t.owner.token, t.slug, z.id, {
      toColumnId: prog,
      prevTaskId: first,
      nextTaskId: second,
    });
    expect((await readBoard(t.owner.token, t.slug)).order(prog)).toEqual([
      a.id,
      first,
      z.id,
      second,
      b.id,
    ]);
  });

  it('five drops into one gap at once: all succeed, all between, all ranks distinct', async () => {
    const { t, prog, todo, a, b } = await setup();
    const extra: TaskDto[] = [];
    for (let i = 0; i < 5; i++)
      extra.push(await makeTask(t.owner.token, t.ws, 'MOB', { title: `r${i}`, columnId: todo }));
    const results = await Promise.all(
      extra.map((e) =>
        move(t.owner.token, t.slug, e.id, { toColumnId: prog, prevTaskId: a.id, nextTaskId: b.id }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const view = await readBoard(t.owner.token, t.slug);
    const order = view.order(prog);
    expect(order[0]).toBe(a.id);
    expect(order.at(-1)).toBe(b.id);
    expect(order.slice(1, 6).sort()).toEqual(extra.map((e) => e.id).sort());
    const ranks = order.map((id) => view.rankOf(id));
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('a stale neighbour (now in another column) is ignored: the other one, or the bottom, is used', async () => {
    const { t, prog, todo, a, b, x, y } = await setup();
    await move(t.owner.token, t.slug, a.id, {
      toColumnId: todo,
      prevTaskId: null,
      nextTaskId: null,
    }); // a left
    // client still thinks a is in prog: "put x after a, before b"
    await move(t.owner.token, t.slug, x.id, {
      toColumnId: prog,
      prevTaskId: a.id,
      nextTaskId: b.id,
    });
    expect((await readBoard(t.owner.token, t.slug)).order(prog)).toEqual([x.id, b.id]);
    // both neighbours stale → bottom
    await move(t.owner.token, t.slug, b.id, {
      toColumnId: todo,
      prevTaskId: null,
      nextTaskId: null,
    });
    await move(t.owner.token, t.slug, y.id, {
      toColumnId: prog,
      prevTaskId: a.id,
      nextTaskId: b.id,
    });
    expect((await readBoard(t.owner.token, t.slug)).order(prog)).toEqual([x.id, y.id]);
  });

  it('neighbours that are no longer adjacent: the card goes right after prev', async () => {
    const { t, prog, todo, a, b, x, y } = await setup();
    await move(t.owner.token, t.slug, y.id, {
      toColumnId: prog,
      prevTaskId: a.id,
      nextTaskId: b.id,
    }); // a y b
    // stale client: "x between a and b" → right after a
    await move(t.owner.token, t.slug, x.id, {
      toColumnId: prog,
      prevTaskId: a.id,
      nextTaskId: b.id,
    });
    expect((await readBoard(t.owner.token, t.slug)).order(prog)).toEqual([a.id, x.id, y.id, b.id]);
    void todo;
  });
});

describe('validation (AC-ORD-03, E3)', () => {
  it('unknown column → 400 INVALID_COLUMN; own id as neighbour → 400', async () => {
    const { t, prog, a } = await setup();
    const col = await move(t.owner.token, t.slug, a.id, {
      toColumnId: String(new Types.ObjectId()),
      prevTaskId: null,
      nextTaskId: null,
    });
    expect(col.status).toBe(400);
    expect(col.body.error.code).toBe('INVALID_COLUMN');
    const self = await move(t.owner.token, t.slug, a.id, {
      toColumnId: prog,
      prevTaskId: a.id,
      nextTaskId: null,
    });
    expect(self.body.error.code).toBe('INVALID_NEIGHBOR');
  });

  it('a neighbour from another project of my workspace → 400; from another workspace → 404', async () => {
    const { t, prog, a } = await setup();
    const web = await makeProject(t.owner.token, t.ws, 'WEB', 'Website');
    const webTask = await makeTask(t.owner.token, t.ws, 'WEB');
    const other = await move(t.owner.token, t.slug, a.id, {
      toColumnId: prog,
      prevTaskId: webTask.id,
      nextTaskId: null,
    });
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe('INVALID_NEIGHBOR');

    const tt = await twoTenants();
    const foreign = await move(t.owner.token, t.slug, a.id, {
      toColumnId: prog,
      prevTaskId: tt.b.task.id,
      nextTaskId: null,
    });
    expect(foreign.status).toBe(404);
    // and a column from another project → 400
    const wrongCol = await move(t.owner.token, t.slug, a.id, {
      toColumnId: web.columns[0]!.id,
      prevTaskId: null,
      nextTaskId: null,
    });
    expect(wrongCol.body.error.code).toBe('INVALID_COLUMN');
  });

  it('archived project → 409; a viewer → 403', async () => {
    const { t, prog, x } = await setup();
    expect(
      (
        await move(t.viewer.token, t.slug, x.id, {
          toColumnId: prog,
          prevTaskId: null,
          nextTaskId: null,
        })
      ).status,
    ).toBe(403);
    await as(t.owner.token).post(`/api/w/${t.slug}/projects/MOB/archive`);
    const res = await move(t.owner.token, t.slug, x.id, {
      toColumnId: prog,
      prevTaskId: null,
      nextTaskId: null,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
  });
});

describe('one write per move', () => {
  it('a move writes exactly ONE tasks document (checked with Mongoose debug)', async () => {
    const { t, prog, a, b, x } = await setup();
    const writes: string[] = [];
    const WRITE_OPS =
      /^(insert|update|replace|delete|findOneAndUpdate|findOneAndReplace|findOneAndDelete|bulkWrite)/i;
    mongoose.set('debug', (collection: string, method: string) => {
      if (collection === 'tasks' && WRITE_OPS.test(method)) writes.push(method);
    });
    try {
      await move(t.owner.token, t.slug, x.id, {
        toColumnId: prog,
        prevTaskId: a.id,
        nextTaskId: b.id,
      });
    } finally {
      mongoose.set('debug', false);
    }
    expect(writes).toEqual(['findOneAndUpdate']);
  });
});

describe('rebalance (FR-ORD-10, E12)', () => {
  it('re-spaces long ranks into short ones and keeps the order', async () => {
    const t = await makeTeam();
    const col = t.project.columns[2]!; // Review: empty
    const long = ['a0', 'a0V', 'a0VV', 'a0VVV', 'a0VVVV'].map((r) => r + 'V'.repeat(60));
    const docs = await Task.insertMany(
      long.map((rank, i) => ({
        workspaceId: oid(t.ws.id),
        projectId: oid(t.project.id),
        number: 100 + i,
        title: `long ${i}`,
        columnId: oid(col.id),
        rank,
        reporterId: oid(t.owner.user.id),
      })),
    );
    const ctx = makeCtx({
      userId: oid(t.owner.user.id),
      workspaceId: oid(t.ws.id),
      role: 'owner',
      tz: 'UTC',
    });
    const ranks = await rebalanceColumn(ctx, oid(t.project.id), oid(col.id));

    const values = docs.map((d) => ranks[String(d._id)]!);
    expect(values.every((r) => r.length < 5)).toBe(true);
    expect([...values].sort()).toEqual(values); // order preserved
    const view = await readBoard(t.owner.token, t.slug);
    expect(view.order(col.id)).toEqual(docs.map((d) => String(d._id)));
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'column.rebalanced', columnId: col.id }),
    );
  });

  it('a move that produces a very long rank triggers it in the background', async () => {
    const t = await makeTeam();
    const col = t.project.columns[2]!; // Review: empty
    // Splitting one gap over and over grows keys only ~1 char per 6 splits, so start from two
    // neighbours that ALREADY have long, adjacent ranks (as after months of heavy use).
    const base = 'a0' + 'V'.repeat(55);
    const [upper, lower] = await Task.insertMany(
      [base, base + 'V'].map((rank, i) => ({
        workspaceId: oid(t.ws.id),
        projectId: oid(t.project.id),
        number: 200 + i,
        title: i === 0 ? 'upper' : 'lower',
        columnId: oid(col.id),
        rank,
        reporterId: oid(t.owner.user.id),
      })),
    );
    const res = await move(t.owner.token, t.slug, t.task.id, {
      toColumnId: col.id,
      prevTaskId: String(upper!._id),
      nextTaskId: String(lower!._id),
    });
    expect(res.body.task.rank.length).toBeGreaterThan(50); // the move itself succeeds normally

    // The rebalance runs after the response; wait for its event.
    for (let i = 0; i < 50 && !events.some((e) => e.type === 'column.rebalanced'); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'column.rebalanced', columnId: col.id }),
    );
    const view = await readBoard(t.owner.token, t.slug);
    const inCol = view.board.tasks.filter((x) => x.columnId === col.id);
    expect(inCol.every((x) => x.rank.length < 10)).toBe(true);
    expect(view.order(col.id)).toEqual([String(upper!._id), t.task.id, String(lower!._id)]);
  }, 60_000);
});
