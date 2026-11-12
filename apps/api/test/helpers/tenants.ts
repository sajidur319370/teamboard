import { Types } from 'mongoose';
import type { Role, WorkspaceDto } from '@teamboard/shared';
import { Membership } from '../../src/db/models';
import { as, registerUser } from './auth';

let n = 0;

export async function makeWorkspace(token: string, name = 'Acme') {
  const slug = `ws-${++n}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await as(token).post('/api/workspaces').send({ name, slug });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.workspace as WorkspaceDto;
}

/** Two companies, each with an owner. Use this in EVERY tenant test so leaks show up. */
export async function twoTenants() {
  const alice = await registerUser('Alice');
  const bob = await registerUser('Bob');
  const wsA = await makeWorkspace(alice.token, 'A Corp');
  const wsB = await makeWorkspace(bob.token, 'B Corp');
  return { a: { ...alice, ws: wsA }, b: { ...bob, ws: wsB } };
}

/**
 * Registers a new user and puts them straight into a workspace with `role`.
 * A shortcut until invites exist (Day 6); writes the membership directly.
 */
export async function addMember(ws: WorkspaceDto, role: Exclude<Role, 'owner'>, name?: string) {
  const user = await registerUser(name ?? `${role} user`);
  await Membership.create({
    workspaceId: new Types.ObjectId(ws.id),
    userId: new Types.ObjectId(user.user.id),
    role,
  });
  return user;
}

/** Owner + admin + member + viewer in one workspace, plus an outsider with no membership. */
export async function fourRoles() {
  const owner = await registerUser('Olivia Owner');
  const ws = await makeWorkspace(owner.token, 'Roles Inc');
  return {
    ws,
    owner,
    admin: await addMember(ws, 'admin', 'Arif Admin'),
    member: await addMember(ws, 'member', 'Rahim Member'),
    viewer: await addMember(ws, 'viewer', 'Vera Viewer'),
    outsider: await registerUser('Nadia Nobody'),
  };
}
