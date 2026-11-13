import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BoardResponse, ColumnDto, ProjectDto, TaskCardDto } from '@teamboard/shared';
import { qk } from '@/api/keys';
import { getSocket } from './client';
import { isOwnMutation } from './mutationIds';
import { whenWorkspaceJoined } from './workspaceJoin';
import { applyRanks, removeTask, upsertTask } from './boardCache';

/** Apply fn to EVERY cached view of this board (active / backlog / all / sprint X). */
function updateBoards(
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

/**
 * Joins board:<projectId> (after the workspace room) and patches the cache from events.
 * Patch, don't refetch: events carry the full entity (FR-RT-07).
 */
export function useBoardSocket(slug: string, key: string, projectId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!projectId) return;
    const s = getSocket();
    const join = () =>
      s.emit('board:join', { projectId }, (r) => {
        if (!r.ok) console.warn('board:join failed', r.code);
      });
    const mine = (p: { clientMutationId?: string }) => isOwnMutation(p.clientMutationId); // FR-RT-08
    const refreshDrawer = (n: number) =>
      void qc.invalidateQueries({ queryKey: qk.task(slug, key, n) });
    const refetchBoard = () => void qc.invalidateQueries({ queryKey: qk.boardAll(slug, key) });

    const onTask = (p: { task: TaskCardDto; clientMutationId?: string }) => {
      if (mine(p)) return; // this tab already applied it optimistically
      updateBoards(qc, slug, key, (b) => upsertTask(b, p.task));
      refreshDrawer(p.task.number); // an open drawer shows the new values
      void qc.invalidateQueries({ queryKey: qk.myTasks(slug) });
    };
    const onDeleted = (p: { taskId: string; number: number; clientMutationId?: string }) => {
      if (mine(p)) return;
      updateBoards(qc, slug, key, (b) => removeTask(b, p.taskId));
      qc.removeQueries({ queryKey: qk.task(slug, key, p.number) }); // open drawer → "deleted" (E2)
    };
    const onColumns = (p: { columns: ColumnDto[] }) =>
      updateBoards(qc, slug, key, (b) => ({ ...b, project: { ...b.project, columns: p.columns } }));
    const onRebalanced = (p: { ranks: Record<string, string> }) =>
      updateBoards(qc, slug, key, (b) => applyRanks(b, p.ranks));
    const onProject = (p: { project: ProjectDto }) =>
      updateBoards(qc, slug, key, (b) => ({ ...b, project: p.project })); // labels, archived banner (E17)

    const stopJoining = whenWorkspaceJoined(join); // joins now if ready, and after every reconnect
    s.on('task:created', onTask);
    s.on('task:updated', onTask);
    s.on('task:moved', onTask);
    s.on('task:deleted', onDeleted);
    s.on('column:created', onColumns);
    s.on('column:reordered', onColumns);
    // A category change also changes its tasks' completedAt, and a delete moves tasks:
    // the payload only has the columns, so refetch the board.
    s.on('column:updated', refetchBoard);
    s.on('column:deleted', refetchBoard);
    s.on('column:rebalanced', onRebalanced);
    s.on('project:updated', onProject);
    s.on('project:archived', onProject);
    s.on('project:deleted', refetchBoard); // the refetch 404s → "this project was deleted"

    return () => {
      s.emit('board:leave', { projectId });
      stopJoining();
      s.off('task:created', onTask);
      s.off('task:updated', onTask);
      s.off('task:moved', onTask);
      s.off('task:deleted', onDeleted);
      s.off('column:created', onColumns);
      s.off('column:reordered', onColumns);
      s.off('column:updated', refetchBoard);
      s.off('column:deleted', refetchBoard);
      s.off('column:rebalanced', onRebalanced);
      s.off('project:updated', onProject);
      s.off('project:archived', onProject);
      s.off('project:deleted', refetchBoard);
    };
  }, [slug, key, projectId, qc]);
}
