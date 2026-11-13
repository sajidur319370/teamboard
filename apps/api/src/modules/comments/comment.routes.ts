import { Router } from 'express';
import { commentBodySchema, commentIdParams, commentsQuery, taskIdParams } from '@teamboard/shared';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { oid } from '../../lib/ids';
import * as svc from './comment.service';

/** /api/w/:slug/tasks/:taskId/comments: a task's thread. */
export const taskCommentsRouter = Router({ mergeParams: true });

const listReq = { params: taskIdParams, query: commentsQuery };
taskCommentsRouter.get('/', authorize('comment:view'), validate(listReq), async (req, res) => {
  const { params, query } = valid(req, listReq);
  res.json(await svc.listComments(req.ctx, oid(params.taskId), query));
});

const createReq = { params: taskIdParams, body: commentBodySchema };
taskCommentsRouter.post('/', authorize('comment:create'), validate(createReq), async (req, res) => {
  const { params, body } = valid(req, createReq);
  res.status(201).json(await svc.createComment(req.ctx, oid(params.taskId), body.body));
});

/** /api/w/:slug/comments/:commentId: edit / delete one comment (ownership checked in the service). */
export const commentsRouter = Router({ mergeParams: true });

const updateReq = { params: commentIdParams, body: commentBodySchema };
commentsRouter.patch(
  '/:commentId',
  authorize('comment:update'),
  validate(updateReq),
  async (req, res) => {
    const { params, body } = valid(req, updateReq);
    res.json({ comment: await svc.updateComment(req.ctx, oid(params.commentId), body.body) });
  },
);

const deleteReq = { params: commentIdParams };
commentsRouter.delete(
  '/:commentId',
  authorize('comment:delete'),
  validate(deleteReq),
  async (req, res) => {
    const { params } = valid(req, deleteReq);
    res.json(await svc.deleteComment(req.ctx, oid(params.commentId)));
  },
);
