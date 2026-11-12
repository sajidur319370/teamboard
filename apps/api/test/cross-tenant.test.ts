import { beforeEach, describe, expect, it } from 'vitest';
import { listRoutes } from '../src/lib/routeRegistry';
import { workspaceRouter } from '../src/modules/workspaces/workspace.routes';
import { as } from './helpers/auth';
import { twoTenants } from './helpers/tenants';

type T = Awaited<ReturnType<typeof twoTenants>>;
type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
type Probe = {
  /** The route this probe covers, exactly as the router declares it: 'PATCH /' */
  route: string;
  name: string;
  method: Method;
  path: (t: T) => string;
  body?: object;
};

/**
 * Alice (workspace A) tries to reach workspace B. Every probe must return 404.
 * THIS LIST GROWS EVERY DAY: one probe per tenant-scoped route (the coverage test enforces it).
 */
const PROBES: Probe[] = [
  {
    route: 'GET /',
    name: 'get workspace',
    method: 'get',
    path: (t) => `/api/w/${t.b.ws.slug}`,
  },
  {
    route: 'PATCH /',
    name: 'update workspace',
    method: 'patch',
    path: (t) => `/api/w/${t.b.ws.slug}`,
    body: { name: 'pwned' },
  },
  {
    route: 'DELETE /',
    name: 'delete workspace',
    method: 'delete',
    path: (t) => `/api/w/${t.b.ws.slug}`,
    body: { confirmName: 'B Corp' },
  },
  // Day 6+: members, invites, projects, tasks, comments, sprints, reports, activities, notifications…
];

/** Alice sends the probe at B's workspace. */
function attack(t: T, probe: Probe) {
  const client = as(t.a.token);
  return client[probe.method](probe.path(t)).send(probe.body ?? {});
}

describe('cross-tenant isolation', () => {
  let t: T;
  beforeEach(async () => {
    t = await twoTenants();
  });

  it.each(PROBES)('$name → 404', async (probe) => {
    const res = await attack(t, probe);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("B's workspace is untouched after all the probes", async () => {
    for (const probe of PROBES) await attack(t, probe);
    const res = await as(t.b.token).get(`/api/w/${t.b.ws.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.workspace.name).toBe('B Corp');
  });

  it('my workspace list never contains B', async () => {
    const me = await as(t.a.token).get('/api/me');
    expect(me.body.workspaces.map((w: { slug: string }) => w.slug)).toEqual([t.a.ws.slug]);
    const list = await as(t.a.token).get('/api/workspaces');
    expect(list.body.workspaces.map((w: { slug: string }) => w.slug)).toEqual([t.a.ws.slug]);
  });
});

describe('cross-tenant coverage (TR-03)', () => {
  it('every tenant-scoped route has a probe, and every probe matches a real route', () => {
    const routes = listRoutes(workspaceRouter).map((r) => `${r.method} ${r.path}`);
    const probed = PROBES.map((p) => p.route);
    expect([...new Set(probed)].sort()).toEqual([...new Set(routes)].sort());
  });
});
