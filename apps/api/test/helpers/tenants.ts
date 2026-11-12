import type { Role, WorkspaceDto } from '@teamboard/shared';
import { as, registerUser } from './auth';

let n = 0;

export async function makeWorkspace(token: string, name = 'Acme') {
  const slug = `ws-${++n}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await as(token).post('/api/workspaces').send({ name, slug });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.workspace as WorkspaceDto;
}

/** Creates an invite as `token` and returns its raw token (the last URL segment) and id. */
export async function makeInvite(
  token: string,
  ws: WorkspaceDto,
  body: { role: Exclude<Role, 'owner'>; maxUses?: number; email?: string; expiresInDays?: number },
) {
  const res = await as(token).post(`/api/w/${ws.slug}/invites`).send(body);
  if (res.status !== 201) throw new Error(`invite failed: ${JSON.stringify(res.body)}`);
  return {
    token: new URL(res.body.url as string).pathname.split('/').pop()!,
    id: res.body.invite.id as string,
    url: res.body.url as string,
  };
}

/** The real flow: invite → register → accept. Returns a logged-in user with `role`. */
export async function addMember(
  ownerToken: string,
  ws: WorkspaceDto,
  role: Exclude<Role, 'owner'>,
  name?: string,
) {
  const inv = await makeInvite(ownerToken, ws, { role, maxUses: 1 });
  const user = await registerUser(name ?? `${role} user`);
  const acc = await as(user.token).post(`/api/invites/${inv.token}/accept`);
  if (acc.status !== 200) throw new Error(`accept failed: ${JSON.stringify(acc.body)}`);
  return user;
}

/** Two companies. Use this in EVERY tenant test so leaks show up. */
export async function twoTenants() {
  const make = async (ownerName: string, wsName: string) => {
    const owner = await registerUser(ownerName);
    const ws = await makeWorkspace(owner.token, wsName);
    const member = await addMember(owner.token, ws, 'member', `${wsName} member`);
    const invite = await makeInvite(owner.token, ws, { role: 'viewer' });
    return { ...owner, ws, member, inviteId: invite.id };
  };
  return { a: await make('Alice', 'A Corp'), b: await make('Bob', 'B Corp') };
}

/**
 * One workspace with a user of each role, a spare Viewer ("target") to act on,
 * an outsider with no membership, and an open viewer invite to revoke.
 */
export async function makeTeam() {
  const owner = await registerUser('Olivia Owner');
  const ws = await makeWorkspace(owner.token, 'Roles Inc');
  const admin = await addMember(owner.token, ws, 'admin', 'Arif Admin');
  const member = await addMember(owner.token, ws, 'member', 'Rahim Member');
  const viewer = await addMember(owner.token, ws, 'viewer', 'Vera Viewer');
  const target = await addMember(owner.token, ws, 'viewer', 'Tariq Target');
  const outsider = await registerUser('Nadia Nobody');
  const invite = await makeInvite(owner.token, ws, { role: 'viewer' });
  return { ws, slug: ws.slug, owner, admin, member, viewer, target, outsider, inviteId: invite.id };
}
export type Team = Awaited<ReturnType<typeof makeTeam>>;
