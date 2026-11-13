import { Router } from 'express';
import { activityQuery } from '@teamboard/shared';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { listActivities } from './activity.service';

/** /api/w/:slug/activities?projectId=&taskId=&actorId=&group=&cursor= (FR-ACT-06/07) */
export const activitiesRouter = Router({ mergeParams: true });

const listReq = { query: activityQuery };
activitiesRouter.get('/', authorize('activity:view'), validate(listReq), async (req, res) => {
  res.json(await listActivities(req.ctx, valid(req, listReq).query));
});
