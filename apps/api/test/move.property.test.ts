import { describe, expect, it } from 'vitest';
import { as } from './helpers/auth';
import { move, readBoard } from './helpers/board';
import { makeTeam } from './helpers/tenants';

/** Small seeded PRNG, so a failing run can be reproduced exactly. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// AC-ORD-01 / M5 exit criterion: 1,000 random moves never produce a wrong order.
describe('move: 1,000 random moves (property test)', () => {
  it('the server order always equals an in-memory model; one write per real move', async () => {
    const SEED = 42;
    const rand = mulberry32(SEED);
    const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)]!;

    const { owner, slug, project, task } = await makeTeam();
    const api = as(owner.token);
    const [colA, colB] = [project.columns[0]!.id, project.columns[1]!.id];

    // The fixture task is already in column A; add 19 more there.
    const model: Record<string, string[]> = { [colA]: [task.id], [colB]: [] };
    for (let i = 1; i < 20; i++) {
      const t = (
        await api.post(`/api/w/${slug}/projects/MOB/tasks`).send({ title: `T${i}`, columnId: colA })
      ).body.task;
      model[colA]!.push(t.id);
    }

    let { versions } = await readBoard(owner.token, slug);
    let writes = 0;

    for (let i = 1; i <= 1000; i++) {
      const fromCol =
        model[colA]!.length && (model[colB]!.length === 0 || rand() < 0.5) ? colA : colB;
      const taskId = pick(model[fromCol]!);
      const toCol = rand() < 0.8 ? fromCol : fromCol === colA ? colB : colA; // mostly reorders

      model[fromCol] = model[fromCol]!.filter((id) => id !== taskId);
      const target = model[toCol]!;
      const index = Math.floor(rand() * (target.length + 1));
      const prevTaskId = target[index - 1] ?? null;
      const nextTaskId = target[index] ?? null;
      target.splice(index, 0, taskId);

      const res = await move(owner.token, slug, taskId, {
        toColumnId: toCol,
        prevTaskId,
        nextTaskId,
      });
      expect(res.status, `move #${i} (seed ${SEED}): ${JSON.stringify(res.body)}`).toBe(200);
      if (!res.body.noop) writes++;

      if (i % 100 === 0) {
        const now = await readBoard(owner.token, slug);
        expect(
          { [colA]: now.order(colA), [colB]: now.order(colB) },
          `order after move #${i}`,
        ).toEqual(model);
        expect(now.versions - versions, 'exactly one task version bump per real move').toBe(writes);
        // ranks stay unique and short (no rebalance needed for random positions)
        const ranks = now.board.tasks.map((t) => t.rank);
        expect(new Set(ranks).size).toBe(ranks.length);
        versions = now.versions;
        writes = 0;
      }
    }
  }, 300_000);
});
