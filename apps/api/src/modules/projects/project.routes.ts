import { Router } from 'express';
import {
  columnParams,
  createColumnSchema,
  createProjectSchema,
  deleteColumnSchema,
  deleteProjectSchema,
  keyParams,
  labelParams,
  labelSchema,
  listProjectsQuery,
  reorderColumnsSchema,
  updateColumnSchema,
  updateLabelSchema,
  updateProjectSchema,
} from '@teamboard/shared';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { oid } from '../../lib/ids';
import * as projects from './project.service';
import * as columns from './column.service';
import * as labels from './label.service';

/** /api/w/:slug/projects. Projects are addressed by key in URLs (FR-PRJ-10). */
export const projectsRouter = Router({ mergeParams: true });

const listReq = { query: listProjectsQuery };
projectsRouter.get('/', authorize('project:view'), validate(listReq), async (req, res) => {
  const includeArchived = valid(req, listReq).query.archived === 'true';
  res.json({ projects: await projects.listProjects(req.ctx, includeArchived) });
});

const createReq = { body: createProjectSchema };
projectsRouter.post('/', authorize('project:create'), validate(createReq), async (req, res) => {
  res
    .status(201)
    .json({ project: await projects.createProject(req.ctx, valid(req, createReq).body) });
});

const keyReq = { params: keyParams };
projectsRouter.get('/:key', authorize('project:view'), validate(keyReq), async (req, res) => {
  res.json({ project: await projects.getProject(req.ctx, valid(req, keyReq).params.key) });
});

const updateReq = { params: keyParams, body: updateProjectSchema };
projectsRouter.patch(
  '/:key',
  authorize('project:update'),
  validate(updateReq),
  async (req, res) => {
    const { params, body } = valid(req, updateReq);
    res.json({ project: await projects.updateProject(req.ctx, params.key, body) });
  },
);

projectsRouter.post(
  '/:key/archive',
  authorize('project:archive'),
  validate(keyReq),
  async (req, res) => {
    res.json({ project: await projects.setArchived(req.ctx, valid(req, keyReq).params.key, true) });
  },
);

projectsRouter.post(
  '/:key/unarchive',
  authorize('project:archive'),
  validate(keyReq),
  async (req, res) => {
    res.json({
      project: await projects.setArchived(req.ctx, valid(req, keyReq).params.key, false),
    });
  },
);

const deleteReq = { params: keyParams, body: deleteProjectSchema };
projectsRouter.delete(
  '/:key',
  authorize('project:delete'),
  validate(deleteReq),
  async (req, res) => {
    const { params, body } = valid(req, deleteReq);
    await projects.deleteProject(req.ctx, params.key, body.confirmKey);
    res.status(204).end();
  },
);

// ── Columns (FR-BRD-02..06) ────────────────────────────────────────────────

const addColReq = { params: keyParams, body: createColumnSchema };
projectsRouter.post(
  '/:key/columns',
  authorize('column:manage'),
  validate(addColReq),
  async (req, res) => {
    const { params, body } = valid(req, addColReq);
    res.status(201).json({ columns: await columns.addColumn(req.ctx, params.key, body) });
  },
);

const orderReq = { params: keyParams, body: reorderColumnsSchema };
projectsRouter.put(
  '/:key/columns/order',
  authorize('column:manage'),
  validate(orderReq),
  async (req, res) => {
    const { params, body } = valid(req, orderReq);
    res.json({ columns: await columns.reorderColumns(req.ctx, params.key, body.columnIds) });
  },
);

const updColReq = { params: columnParams, body: updateColumnSchema };
projectsRouter.patch(
  '/:key/columns/:columnId',
  authorize('column:manage'),
  validate(updColReq),
  async (req, res) => {
    const { params, body } = valid(req, updColReq);
    res.json({
      columns: await columns.updateColumn(req.ctx, params.key, oid(params.columnId), body),
    });
  },
);

const delColReq = { params: columnParams, body: deleteColumnSchema };
projectsRouter.delete(
  '/:key/columns/:columnId',
  authorize('column:manage'),
  validate(delColReq),
  async (req, res) => {
    const { params, body } = valid(req, delColReq);
    const target = body.targetColumnId ? oid(body.targetColumnId) : undefined;
    res.json({
      columns: await columns.deleteColumn(req.ctx, params.key, oid(params.columnId), target),
    });
  },
);

// ── Labels (FR-PRJ-08) ─────────────────────────────────────────────────────

const addLabelReq = { params: keyParams, body: labelSchema };
projectsRouter.post(
  '/:key/labels',
  authorize('project:update'),
  validate(addLabelReq),
  async (req, res) => {
    const { params, body } = valid(req, addLabelReq);
    res.status(201).json({ labels: await labels.addLabel(req.ctx, params.key, body) });
  },
);

const updLabelReq = { params: labelParams, body: updateLabelSchema };
projectsRouter.patch(
  '/:key/labels/:labelId',
  authorize('project:update'),
  validate(updLabelReq),
  async (req, res) => {
    const { params, body } = valid(req, updLabelReq);
    res.json({ labels: await labels.updateLabel(req.ctx, params.key, oid(params.labelId), body) });
  },
);

const delLabelReq = { params: labelParams };
projectsRouter.delete(
  '/:key/labels/:labelId',
  authorize('project:update'),
  validate(delLabelReq),
  async (req, res) => {
    const { params } = valid(req, delLabelReq);
    res.json({ labels: await labels.deleteLabel(req.ctx, params.key, oid(params.labelId)) });
  },
);
