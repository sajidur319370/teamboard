import { Router } from 'express';
import { burndownQuery, sprintIdParams } from '@teamboard/shared';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { oid } from '../../lib/ids';
import * as svc from './report.service';

/** /api/w/:slug/sprints/:sprintId/reports/*: every role can read reports (FR-RPT-08, J5). */
export const reportsRouter = Router({ mergeParams: true });

const burndownReq = { params: sprintIdParams, query: burndownQuery };
reportsRouter.get(
  '/burndown',
  authorize('report:view'),
  validate(burndownReq),
  async (req, res) => {
    const { params, query } = valid(req, burndownReq);
    res.json(await svc.burndownReport(req.ctx, oid(params.sprintId), query.unit));
  },
);

const idReq = { params: sprintIdParams };
reportsRouter.get('/members', authorize('report:view'), validate(idReq), async (req, res) => {
  res.json(await svc.membersReport(req.ctx, oid(valid(req, idReq).params.sprintId)));
});

reportsRouter.get('/summary', authorize('report:view'), validate(idReq), async (req, res) => {
  res.json(await svc.summaryReport(req.ctx, oid(valid(req, idReq).params.sprintId)));
});
