import type { RequestHandler, Router } from 'express';

// Express 5 doesn't keep the path string of a mounted sub-router, so we record it here.
// That lets tests list every route (method + full path + handlers) to check that each one
// declares authorize() (FR-RBAC-05) and has a cross-tenant probe (TR-03).

const mountPaths = new WeakMap<object, string>();

/** Use instead of `parent.use(path, child)` for feature routers inside the workspace router. */
export function mount(parent: Router, path: string, child: Router): void {
  mountPaths.set(child, path);
  parent.use(path, child);
}

export interface RouteInfo {
  method: string; // 'GET', 'PATCH', ...
  path: string; // e.g. '/members/:userId'
  handlers: RequestHandler[];
}

interface LayerLike {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: RequestHandler }[] };
  handle: { stack?: LayerLike[] };
}

export function listRoutes(router: Router, prefix = ''): RouteInfo[] {
  const out: RouteInfo[] = [];
  for (const layer of (router as unknown as { stack: LayerLike[] }).stack) {
    if (layer.route) {
      const path = (prefix + layer.route.path).replace(/(.)\/$/, '$1') || '/';
      for (const method of Object.keys(layer.route.methods)) {
        out.push({
          method: method.toUpperCase(),
          path,
          handlers: layer.route.stack.map((l) => l.handle),
        });
      }
    } else if (Array.isArray(layer.handle.stack)) {
      const mounted = mountPaths.get(layer.handle);
      if (mounted === undefined) {
        throw new Error(`A sub-router under "${prefix || '/'}" was mounted without mount()`);
      }
      const childPrefix = mounted === '/' ? prefix : prefix + mounted;
      out.push(...listRoutes(layer.handle as unknown as Router, childPrefix));
    }
  }
  return out;
}
