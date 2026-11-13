import type { BoardResponse } from '@teamboard/shared';
import { as } from './auth';

type Card = { id: string; columnId: string; rank: string; version: number };

/** Same order as MongoDB + the client: binary compare of rank, then id. */
export const byRank = (x: Card, y: Card) =>
  x.rank !== y.rank ? (x.rank < y.rank ? -1 : 1) : x.id < y.id ? -1 : x.id > y.id ? 1 : 0;

/** Loads the board ("all" view) and returns helpers to read column orders from it. */
export async function readBoard(token: string, slug: string, key = 'MOB') {
  const board = (await as(token).get(`/api/w/${slug}/projects/${key}/board?sprint=all`))
    .body as BoardResponse;
  const tasks = board.tasks as Card[];
  return {
    board,
    order: (columnId: string) =>
      tasks
        .filter((t) => t.columnId === columnId)
        .sort(byRank)
        .map((t) => t.id),
    rankOf: (taskId: string) => tasks.find((t) => t.id === taskId)?.rank,
    versions: tasks.reduce((s, t) => s + t.version, 0),
  };
}

export const move = (
  token: string,
  slug: string,
  taskId: string,
  body: { toColumnId: string; prevTaskId: string | null; nextTaskId: string | null },
) => as(token).patch(`/api/w/${slug}/tasks/${taskId}/move`).send(body);
