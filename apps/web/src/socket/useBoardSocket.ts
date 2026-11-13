import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDto, CommentDto, ProjectDto, TaskCardDto } from '@teamboard/shared';
import { qk } from '@/api/keys';
import { getSocket } from './client';
import { isOwnMutation } from './mutationIds';
import { whenWorkspaceJoined } from './workspaceJoin';
import { applyRanks, removeTask, upsertTask } from './boardCache';
import { appendComment, removeComment, replaceComment } from './commentsCache';
import { patchCommentCount, patchComments, updateBoards } from './queryPatches';

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
    // An open History tab / project feed shows the change (only ACTIVE feeds refetch).
    const refreshFeeds = () => void qc.invalidateQueries({ queryKey: qk.activityAll(slug) });

    const onTask = (p: { task: TaskCardDto; clientMutationId?: string }) => {
      refreshFeeds(); // own changes too: the History tab isn't patched optimistically
      if (mine(p)) return; // this tab already applied it optimistically
      updateBoards(qc, slug, key, (b) => upsertTask(b, p.task));
      refreshDrawer(p.task.number); // an open drawer shows the new values
      void qc.invalidateQueries({ queryKey: qk.myTasks(slug) });
    };
    const onDeleted = (p: { taskId: string; number: number; clientMutationId?: string }) => {
      refreshFeeds();
      if (mine(p)) return;
      updateBoards(qc, slug, key, (b) => removeTask(b, p.taskId));
      qc.removeQueries({ queryKey: qk.task(slug, key, p.number) }); // open drawer → "deleted" (E2)
      qc.removeQueries({ queryKey: qk.comments(slug, p.taskId) });
    };
    const onColumns = (p: { columns: ColumnDto[] }) =>
      updateBoards(qc, slug, key, (b) => ({ ...b, project: { ...b.project, columns: p.columns } }));
    const onRebalanced = (p: { ranks: Record<string, string> }) =>
      updateBoards(qc, slug, key, (b) => applyRanks(b, p.ranks));
    // FR-CMT-06: every open drawer of the task gets the comment; every card gets the count.
    type CommentEvent = { taskId: string; commentCount: number; clientMutationId?: string };
    const onCommentCreated = (p: CommentEvent & { comment: CommentDto }) => {
      refreshFeeds();
      if (mine(p)) return; // this tab already added it (onSuccess)
      patchComments(qc, slug, p.taskId, (d) => appendComment(d, p.comment));
      patchCommentCount(qc, slug, key, p.taskId, p.commentCount);
    };
    const onCommentUpdated = (p: { comment: CommentDto; clientMutationId?: string }) => {
      if (mine(p)) return;
      patchComments(qc, slug, p.comment.taskId, (d) => replaceComment(d, p.comment));
    };
    const onCommentDeleted = (p: CommentEvent & { commentId: string }) => {
      refreshFeeds();
      if (mine(p)) return;
      patchComments(qc, slug, p.taskId, (d) => removeComment(d, p.commentId));
      patchCommentCount(qc, slug, key, p.taskId, p.commentCount);
    };
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
    s.on('comment:created', onCommentCreated);
    s.on('comment:updated', onCommentUpdated);
    s.on('comment:deleted', onCommentDeleted);

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
      s.off('comment:created', onCommentCreated);
      s.off('comment:updated', onCommentUpdated);
      s.off('comment:deleted', onCommentDeleted);
    };
  }, [slug, key, projectId, qc]);
}
