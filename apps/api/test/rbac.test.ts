import { describe, expect, it } from 'vitest';
import { can, type Permission, type Role } from '@teamboard/shared';
import { listRoutes } from '../src/lib/routeRegistry';
import { authorizeHandlers } from '../src/middleware/authorize';
import { tenantRouter } from '../src/tenantRouter';
import { as } from './helpers/auth';
import { makeTeam, type Team } from './helpers/tenants';

// TR-04 / AC-RBAC-01: every tenant route × {owner, admin, member, viewer, non-member}.
// The rows are DISCOVERED from the router and each route's permission is read from its
// authorize() handler, so the matrix can't drift from the code or miss a new route.
// Expected statuses come from the shared PERMISSIONS map.

/** Path params → an id from the team fixture. Add an entry when a route gets a new :param. */
const PARAMS: Record<string, (t: Team) => string> = {
  userId: (t) => t.target.user.id,
  inviteId: (t) => t.inviteId,
};

function urlFor(path: string, t: Team) {
  const filled = path.replace(/:(\w+)/g, (_, name: string) => {
    const pick = PARAMS[name];
    if (!pick) throw new Error(`No RBAC fixture for ":${name}". Add it to PARAMS.`);
    return pick(t);
  });
  return `/api/w/${t.slug}${filled === '/' ? '' : filled}`;
}

const ROWS = listRoutes(tenantRouter).map((r) => ({
  name: `${r.method} ${r.path}`,
  method: r.method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: r.path,
  perm: authorizeHandlers.get(r.handlers[0]!) as Permission,
}));

// Forbidden actors first (no side effects), allowed actors last.
const ACTORS = ['viewer', 'member', 'outsider', 'admin', 'owner'] as const;

describe('RBAC matrix', () => {
  it('covers every tenant route', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(11);
    for (const row of ROWS) expect(row.perm, row.name).toBeTruthy();
  });

  it.each(ROWS)('$name ($perm)', async (row) => {
    const team = await makeTeam(); // fresh fixture per row: allowed calls may change data
    for (const actor of ACTORS) {
      // {} is an invalid body for most writes: allowed roles get 400 and nothing changes.
      // authorize runs BEFORE validate, so forbidden roles still get their 403.
      const res = await as(team[actor].token)[row.method](urlFor(row.path, team)).send({});
      const label = `${actor} → ${row.name} (got ${res.status} ${JSON.stringify(res.body)})`;

      if (actor === 'outsider') {
        expect(res.status, label).toBe(404); // non-members can't even learn it exists
      } else if (can(actor as Role, row.perm)) {
        expect(res.status, label).not.toBe(403);
        expect(res.status, label).toBeLessThan(500);
      } else {
        expect(res.status, label).toBe(403);
        expect(res.body.error.details, label).toEqual({ permission: row.perm });
      }
    }
  });
});
