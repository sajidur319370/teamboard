import { Router, type RequestHandler } from 'express';
import { describe, expect, it } from 'vitest';
import { authorize, authorizeHandlers } from '../src/middleware/authorize';
import { listRoutes, mount } from '../src/lib/routeRegistry';
import { workspaceRouter } from '../src/modules/workspaces/workspace.routes';

const startsWithAuthorize = (handlers: RequestHandler[]) =>
  !!handlers[0] && authorizeHandlers.has(handlers[0]);

// FR-RBAC-05: every workspace route declares authorize(...), and it runs FIRST
// (before validate), so a Viewer gets 403 even when sending garbage.
describe('route audit', () => {
  const routes = listRoutes(workspaceRouter);

  it('finds the workspace routes', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it.each(routes.map((r) => [`${r.method} ${r.path}`, r] as const))(
    '%s starts with authorize() and declares exactly one permission',
    (_name, route) => {
      expect(startsWithAuthorize(route.handlers)).toBe(true);
      expect(route.handlers.filter((h) => authorizeHandlers.has(h))).toHaveLength(1);
    },
  );
});

// The audit is only worth something if it can fail: prove it on throwaway routers.
describe('the audit itself', () => {
  const ok: RequestHandler = (_req, res) => {
    res.end();
  };

  it('spots a route without authorize()', () => {
    const r = Router();
    r.get('/safe', authorize('task:view'), ok);
    r.post('/forgot', ok);
    const found = listRoutes(r);
    expect(found.map((x) => [x.method, x.path, startsWithAuthorize(x.handlers)])).toEqual([
      ['GET', '/safe', true],
      ['POST', '/forgot', false],
    ]);
  });

  it('joins mount paths of nested routers', () => {
    const root = Router();
    const members = Router();
    const inner = Router();
    inner.delete('/:inviteId', authorize('invite:revoke'), ok);
    members.patch('/:userId', authorize('member:updateRole'), ok);
    mount(members, '/invites', inner);
    mount(root, '/members', members);
    expect(listRoutes(root).map((x) => `${x.method} ${x.path}`)).toEqual([
      'PATCH /members/:userId',
      'DELETE /members/invites/:inviteId',
    ]);
  });

  it('refuses a sub-router mounted with plain use(), whose path it cannot see', () => {
    const root = Router();
    root.use('/hidden', Router().get('/', ok));
    expect(() => listRoutes(root)).toThrow(/without mount\(\)/);
  });
});
