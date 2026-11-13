// Cache writers shared by this tab's mutations and by socket handlers.
import type { QueryClient } from '@tanstack/react-query';
import type { BoardResponse } from '@teamboard/shared';
import { qk } from '@/api/keys';
import type { CommentPages } from './commentsCache';
import { setCommentCount } from './boardCache';

/** Apply fn to EVERY cached view of this board (active / backlog / all / sprint X). */
export function updateBoards(
  qc: QueryClient,
  slug: string,
  key: string,
  fn: (b: BoardResponse) => BoardResponse,
) {
  for (const [queryKey, data] of qc.getQueriesData<BoardResponse>({
    queryKey: qk.boardAll(slug, key),
  })) {
    if (data) qc.setQueryData(queryKey, fn(data));
  }
}

export const patchComments = (
  qc: QueryClient,
  slug: string,
  taskId: string,
  fn: (d: CommentPages | undefined) => CommentPages | undefined,
) => qc.setQueryData<CommentPages>(qk.comments(slug, taskId), fn);

/** The card's 💬 count on every board view. */
export const patchCommentCount = (
  qc: QueryClient,
  slug: string,
  key: string,
  taskId: string,
  count: number,
) => updateBoards(qc, slug, key, (b) => setCommentCount(b, taskId, count));
