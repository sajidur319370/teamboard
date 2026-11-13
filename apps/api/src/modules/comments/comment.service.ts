import type { Types } from 'mongoose';
import {
  LIMITS,
  ROLE_LEVEL,
  type CommentDto,
  type CreateCommentResponse,
  type DeleteCommentResponse,
  type Page,
} from '@teamboard/shared';
import { Activity, Comment, Project, Task } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { afterCursor, pageOf } from '../../lib/cursor';
import { forbidden, notFound } from '../../lib/errors';
import { people } from '../../lib/people';
import { cleanText, excerpt } from '../../lib/text';
import { activity } from '../../events/activity';
import { publish } from '../../events/publish';
import type { Ctx } from '../../types/ctx';
import { assertWritable } from '../projects/project.helpers';
import { taskRef } from '../tasks/task.helpers';

type CommentLean = {
  _id: Types.ObjectId;
  taskId: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  editedAt?: Date | null;
  createdAt: Date;
};

/** One users query for the whole page of authors (no N+1). */
async function toDtos(rows: CommentLean[]): Promise<CommentDto[]> {
  const authors = await people(rows.map((r) => r.authorId));
  return rows.map((r) => ({
    id: String(r._id),
    taskId: String(r.taskId),
    author: authors.get(String(r.authorId))!,
    body: r.body,
    editedAt: r.editedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
const toDto = async (row: CommentLean) => (await toDtos([row]))[0]!;

const projectOf = (ctx: Ctx, projectId: Types.ObjectId) =>
  Project.findOne({ _id: projectId, workspaceId: ctx.workspaceId }).select('key archivedAt').lean();

/** FR-CMT-04 / queries.md §9: oldest first, keyset-paginated. */
export async function listComments(
  ctx: Ctx,
  taskId: Types.ObjectId,
  q: { cursor?: string | undefined; limit: number },
): Promise<Page<CommentDto>> {
  if (!(await Task.exists({ _id: taskId, workspaceId: ctx.workspaceId }))) throw notFound();
  const rows = await Comment.find({
    workspaceId: ctx.workspaceId,
    taskId,
    ...(q.cursor && afterCursor(q.cursor, 'asc')),
  })
    .sort({ createdAt: 1, _id: 1 })
    .limit(q.limit + 1)
    .lean();
  const { items, nextCursor } = pageOf(rows, q.limit);
  return { items: await toDtos(items), nextCursor };
}

/** FR-CMT-01 / FR-CMT-05. The counter moves in the SAME transaction as the insert. */
export async function createComment(
  ctx: Ctx,
  taskId: Types.ObjectId,
  body: string,
): Promise<CreateCommentResponse> {
  const clean = cleanText(body);
  const { comment, task, project } = await withTransaction(async (session) => {
    // Commenters watch the task (Day 17 notifies watchers), up to the watcher cap.
    await Task.updateOne(
      {
        _id: taskId,
        workspaceId: ctx.workspaceId,
        [`watcherIds.${LIMITS.watchersPerTask - 1}`]: { $exists: false },
      },
      { $addToSet: { watcherIds: ctx.userId } },
      { session },
    );
    const t = await Task.findOneAndUpdate(
      { _id: taskId, workspaceId: ctx.workspaceId },
      { $inc: { commentCount: 1 } },
      { returnDocument: 'after', session },
    ).lean();
    if (!t) throw notFound(); // E2: the task was deleted while you typed
    const p = await projectOf(ctx, t.projectId).session(session);
    if (!p) throw notFound();
    assertWritable(p); // archived projects are read-only, comments included (BR-11)

    const [c] = await Comment.create(
      [
        {
          workspaceId: ctx.workspaceId,
          projectId: t.projectId,
          taskId,
          authorId: ctx.userId,
          body: clean,
          createdAt: ctx.now(),
        },
      ],
      { session },
    );
    await Activity.create(
      [
        activity(
          ctx,
          'comment.created',
          { task: taskRef(t, p), excerpt: excerpt(clean) },
          { projectId: t.projectId, taskId, entityId: c!._id },
        ),
      ],
      { session },
    );
    return { comment: c!.toObject(), task: t, project: p };
  });

  const dto = await toDto(comment);
  await publish(ctx, [
    {
      type: 'comment.created',
      projectId: task.projectId,
      taskId: String(taskId),
      comment: dto,
      commentCount: task.commentCount,
      // For notifications (Day 17): who to tell, and what to call the task.
      watcherIds: task.watcherIds.map(String),
      task: taskRef(task, project),
    },
  ]);
  return { comment: dto, commentCount: task.commentCount };
}

/** Load a comment for an edit/delete: 404 if it isn't in this workspace. */
async function loadComment(ctx: Ctx, commentId: Types.ObjectId) {
  const c = await Comment.findOne({ _id: commentId, workspaceId: ctx.workspaceId }).lean();
  if (!c) throw notFound();
  const p = await projectOf(ctx, c.projectId);
  if (!p) throw notFound();
  return { c, p };
}

/** FR-CMT-02: the AUTHOR only. Nobody edits other people's words, not even the Owner. */
export async function updateComment(
  ctx: Ctx,
  commentId: Types.ObjectId,
  body: string,
): Promise<CommentDto> {
  const { c, p } = await loadComment(ctx, commentId);
  if (!c.authorId.equals(ctx.userId)) {
    throw forbidden('FORBIDDEN', 'You can only edit your own comments.');
  }
  assertWritable(p);
  const clean = cleanText(body);
  if (clean === c.body) return toDto(c); // unchanged: no "(edited)", no event

  const updated = await Comment.findOneAndUpdate(
    { _id: commentId, workspaceId: ctx.workspaceId, authorId: ctx.userId },
    { $set: { body: clean, editedAt: ctx.now() } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!updated) throw notFound(); // deleted meanwhile
  const dto = await toDto(updated);
  await publish(ctx, [{ type: 'comment.updated', projectId: updated.projectId, comment: dto }]);
  return dto;
}

/** FR-CMT-03: the author, or Admin+ (moderation). Hard delete; the counter moves with it. */
export async function deleteComment(
  ctx: Ctx,
  commentId: Types.ObjectId,
): Promise<DeleteCommentResponse> {
  const { c, p } = await loadComment(ctx, commentId);
  const moderator = ctx.roleLevel >= ROLE_LEVEL.admin;
  if (!moderator && !c.authorId.equals(ctx.userId)) {
    throw forbidden('FORBIDDEN', 'You can only delete your own comments.');
  }
  assertWritable(p);

  const commentCount = await withTransaction(async (session) => {
    const deleted = await Comment.findOneAndDelete(
      {
        _id: commentId,
        workspaceId: ctx.workspaceId,
        ...(!moderator && { authorId: ctx.userId }),
      },
      { session },
    ).lean();
    if (!deleted) throw notFound(); // a parallel request deleted it first
    const t = await Task.findOneAndUpdate(
      { _id: deleted.taskId, workspaceId: ctx.workspaceId },
      { $inc: { commentCount: -1 } },
      { returnDocument: 'after', session },
    ).lean();
    if (!t) throw notFound(); // can't happen: deleting the task deletes its comments
    await Activity.create(
      [
        activity(
          ctx,
          'comment.deleted',
          { task: taskRef(t, p) },
          { projectId: deleted.projectId, taskId: deleted.taskId, entityId: deleted._id },
        ),
      ],
      { session },
    );
    return t.commentCount;
  });

  await publish(ctx, [
    {
      type: 'comment.deleted',
      projectId: c.projectId,
      taskId: String(c.taskId),
      commentId: String(commentId),
      commentCount,
    },
  ]);
  return { commentCount };
}
