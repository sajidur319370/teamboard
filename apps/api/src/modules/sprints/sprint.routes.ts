import { Router } from 'express';
import {
  completeSprintSchema,
  createSprintSchema,
  keyParams,
  sprintIdParams,
  sprintListQuery,
  sprintTasksSchema,
  updateSprintSchema,
} from '@teamboard/shared';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { oid } from '../../lib/ids';
import * as svc from './sprint.service';

/** /api/w/:slug/projects/:key/{sprints,backlog}: sprints of one project. */
export const projectSprintsRouter = Router({ mergeParams: true });

const listReq = { params: keyParams, query: sprintListQuery };
projectSprintsRouter.get(
  '/sprints',
  authorize('sprint:view'),
  validate(listReq),
  async (req, res) => {
    const { params, query } = valid(req, listReq);
    res.json({ sprints: await svc.listSprints(req.ctx, params.key, query.state) });
  },
);

const createReq = { params: keyParams, body: createSprintSchema };
projectSprintsRouter.post(
  '/sprints',
  authorize('sprint:manage'),
  validate(createReq),
  async (req, res) => {
    const { params, body } = valid(req, createReq);
    res.status(201).json({ sprint: await svc.createSprint(req.ctx, params.key, body) });
  },
);

const backlogReq = { params: keyParams };
projectSprintsRouter.get(
  '/backlog',
  authorize('sprint:view'),
  validate(backlogReq),
  async (req, res) => {
    res.json(await svc.backlogView(req.ctx, valid(req, backlogReq).params.key));
  },
);

/** /api/w/:slug/sprints/:sprintId: one sprint, by id. */
export const sprintsRouter = Router({ mergeParams: true });

const updateReq = { params: sprintIdParams, body: updateSprintSchema };
sprintsRouter.patch(
  '/:sprintId',
  authorize('sprint:manage'),
  validate(updateReq),
  async (req, res) => {
    const { params, body } = valid(req, updateReq);
    res.json({ sprint: await svc.updateSprint(req.ctx, oid(params.sprintId), body) });
  },
);

const idReq = { params: sprintIdParams };
sprintsRouter.delete(
  '/:sprintId',
  authorize('sprint:manage'),
  validate(idReq),
  async (req, res) => {
    await svc.deleteSprint(req.ctx, oid(valid(req, idReq).params.sprintId));
    res.status(204).end();
  },
);

sprintsRouter.post(
  '/:sprintId/start',
  authorize('sprint:manage'),
  validate(idReq),
  async (req, res) => {
    res.json({ sprint: await svc.startSprint(req.ctx, oid(valid(req, idReq).params.sprintId)) });
  },
);

const completeReq = { params: sprintIdParams, body: completeSprintSchema };
sprintsRouter.post(
  '/:sprintId/complete',
  authorize('sprint:manage'),
  validate(completeReq),
  async (req, res) => {
    const { params, body } = valid(req, completeReq);
    res.json(await svc.completeSprint(req.ctx, oid(params.sprintId), body.carryOverTo));
  },
);

const tasksReq = { params: sprintIdParams, body: sprintTasksSchema };
sprintsRouter.post(
  '/:sprintId/tasks',
  authorize('sprint:assignTasks'), // active sprint: Admin+ (service, FR-SPR-04)
  validate(tasksReq),
  async (req, res) => {
    const { params, body } = valid(req, tasksReq);
    res.json(await svc.setSprintTasks(req.ctx, oid(params.sprintId), body.action, body.taskIds));
  },
);
