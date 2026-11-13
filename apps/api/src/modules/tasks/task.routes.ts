import { Router } from 'express';
import { moveTaskSchema, taskIdParams, updateTaskSchema } from '@teamboard/shared';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { oid } from '../../lib/ids';
import * as svc from './task.service';
import { moveTask } from './move.service';

/** /api/w/:slug/tasks/:taskId: tasks addressed by id (create/read-by-number live under projects). */
export const tasksRouter = Router({ mergeParams: true });

// Declared BEFORE the plain /:taskId routes so '/move' is never read as part of an id.
const moveReq = { params: taskIdParams, body: moveTaskSchema };
tasksRouter.patch('/:taskId/move', authorize('task:move'), validate(moveReq), async (req, res) => {
  const { params, body } = valid(req, moveReq);
  // FR-ORD-03 puts clientMutationId in the body; the socket echo (Day 15) reads it from ctx.
  if (body.clientMutationId) req.ctx.clientMutationId = body.clientMutationId;
  res.json(await moveTask(req.ctx, oid(params.taskId), body));
});

const updateReq = { params: taskIdParams, body: updateTaskSchema };
tasksRouter.patch('/:taskId', authorize('task:update'), validate(updateReq), async (req, res) => {
  const { params, body } = valid(req, updateReq);
  res.json({ task: await svc.updateTask(req.ctx, oid(params.taskId), body) });
});

const deleteReq = { params: taskIdParams };
tasksRouter.delete('/:taskId', authorize('task:delete'), validate(deleteReq), async (req, res) => {
  await svc.deleteTask(req.ctx, oid(valid(req, deleteReq).params.taskId));
  res.status(204).end();
});

/** /api/w/:slug/my-tasks (FR-TSK-11) */
export const myTasksRouter = Router({ mergeParams: true });

myTasksRouter.get('/', authorize('task:view'), async (req, res) => {
  res.json(await svc.myTasks(req.ctx));
});
