import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BoardResponse, MoveTaskResponse } from '@teamboard/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { newMutationId } from '@/socket/mutationIds';
import { applyLocalMove, applyServerTask, restoreTask, type MoveVars } from './dnd/dropLogic';

/**
 * Optimistic move (project-overview §10.3):
 *  onMutate  → the card moves in the cache immediately (provisional rank)
 *  onSuccess → the server's rank replaces the guess
 *  onError   → THAT card snaps back (FR-ORD-11) and the board refetches to resync
 */
export function useMoveTask(slug: string, key: string, sprint: string) {
  const qc = useQueryClient();
  const boardKey = qk.board(slug, key, sprint);

  return useMutation({
    mutationFn: (v: MoveVars) =>
      http.patch<MoveTaskResponse>(`/w/${slug}/tasks/${v.taskId}/move`, {
        toColumnId: v.toColumnId,
        prevTaskId: v.prevTaskId,
        nextTaskId: v.nextTaskId,
        clientMutationId: newMutationId(), // our own socket echo is ignored (Day 15)
      }),

    onMutate: async (v) => {
      // An in-flight refetch must not overwrite our optimistic state.
      await qc.cancelQueries({ queryKey: boardKey });
      const board = qc.getQueryData<BoardResponse>(boardKey);
      const original = board?.tasks.find((t) => t.id === v.taskId);
      if (board) qc.setQueryData(boardKey, applyLocalMove(board, v));
      return { original };
    },

    onError: (err, _v, context) => {
      qc.setQueryData<BoardResponse>(boardKey, (b) => (b ? restoreTask(b, context?.original) : b));
      toast.error(`Couldn't move the card: ${err.message}`);
      void qc.invalidateQueries({ queryKey: boardKey });
    },

    onSuccess: ({ task, noop }) => {
      if (!noop)
        qc.setQueryData<BoardResponse>(boardKey, (b) => (b ? applyServerTask(b, task) : b));
    },

    onSettled: () => {
      // Other views of this task are now stale (its column/version changed).
      void qc.invalidateQueries({ queryKey: ['w', slug, 'task', key] });
      void qc.invalidateQueries({ queryKey: qk.myTasks(slug) });
    },
  });
}
