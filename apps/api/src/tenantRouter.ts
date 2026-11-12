import { Router } from 'express';
import { mount } from './lib/routeRegistry';
import { invitesRouter } from './modules/invites/invite.routes';
import { membersRouter, workspaceMemberActions } from './modules/members/member.routes';
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
