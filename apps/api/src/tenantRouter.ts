import { Router } from 'express';
import { mount } from './lib/routeRegistry';
import { activitiesRouter } from './modules/activity/activity.routes';
import { commentsRouter, taskCommentsRouter } from './modules/comments/comment.routes';
import { notificationsRouter } from './notifications/notification.routes';
import { projectSprintsRouter, sprintsRouter } from './modules/sprints/sprint.routes';
import { invitesRouter } from './modules/invites/invite.routes';
import { membersRouter, workspaceMemberActions } from './modules/members/member.routes';
import { projectsRouter } from './modules/projects/project.routes';
import { myTasksRouter, tasksRouter } from './modules/tasks/task.routes';
import { workspaceRouter } from './modules/workspaces/workspace.routes';

/**
 * Everything under /api/w/:slug. authenticate + resolveWorkspace run before it (routes.ts).
 * Rules (enforced by test/route-audit.test.ts and test/cross-tenant.test.ts):
 *  - every route starts with authorize(...)
 *  - every route has a cross-tenant probe
 *  - feature routers are added with mount(), never .use()
 */
export const tenantRouter = Router({ mergeParams: true });

mount(tenantRouter, '/', workspaceRouter);
mount(tenantRouter, '/', workspaceMemberActions);
mount(tenantRouter, '/members', membersRouter);
mount(tenantRouter, '/invites', invitesRouter);
mount(tenantRouter, '/projects/:key', projectSprintsRouter);
mount(tenantRouter, '/projects', projectsRouter);
mount(tenantRouter, '/sprints', sprintsRouter);
mount(tenantRouter, '/tasks/:taskId/comments', taskCommentsRouter);
mount(tenantRouter, '/tasks', tasksRouter);
mount(tenantRouter, '/comments', commentsRouter);
mount(tenantRouter, '/activities', activitiesRouter);
mount(tenantRouter, '/my-tasks', myTasksRouter);
mount(tenantRouter, '/notifications', notificationsRouter);
