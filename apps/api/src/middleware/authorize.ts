import type { RequestHandler } from 'express';
import { can, type Permission } from '@teamboard/shared';
import { forbidden } from '../lib/errors';

/**
 * Remembers which handlers came from authorize(), so a test can prove that every
 * workspace route declares a permission (FR-RBAC-05).
 */
export const authorizeHandlers = new WeakMap<RequestHandler, Permission>();

/**
 * 403 unless the caller's role (from req.ctx, loaded fresh by resolveWorkspace) has the permission.
 * Order on every /w/:slug route: authorize → validate → handler, so a Viewer gets 403
 * even when sending garbage.
 */
export function authorize(permission: Permission): RequestHandler {
  const handler: RequestHandler = (req, _res, next) => {
    if (!can(req.ctx.role, permission)) {
      req.log.warn(
        {
          userId: String(req.ctx.userId),
          workspaceId: String(req.ctx.workspaceId),
          permission,
          route: `${req.method} ${req.originalUrl}`,
        },
        'permission denied', // FR-RBAC-11
      );
      throw forbidden('FORBIDDEN', "You don't have permission to do that.", { permission });
    }
    next();
  };
  authorizeHandlers.set(handler, permission);
  return handler;
}
