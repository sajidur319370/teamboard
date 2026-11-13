import type {
  CommentDto,
  LabelDto,
  ProjectDto,
  Role,
  TaskDto,
  WorkspaceDto,
} from '@teamboard/shared';
import { as, registerUser } from './auth';

/** Creates a task through the API (POST /projects/:key/tasks). */
export async function makeTask(
  token: string,
  ws: WorkspaceDto,
  key: string,
  body: Record<string, unknown> = {},
) {
  const res = await as(token)
    .post(`/api/w/${ws.slug}/projects/${key}/tasks`)
    .send({ title: 'A task', ...body });
  if (res.status !== 201) throw new Error(`task failed: ${JSON.stringify(res.body)}`);
  return res.body.task as TaskDto;
}

/** Adds a comment through the API (POST /tasks/:taskId/comments). */
export async function makeComment(
  token: string,
  ws: WorkspaceDto,
  taskId: string,
  body = 'A comment',
) {
  const res = await as(token).post(`/api/w/${ws.slug}/tasks/${taskId}/comments`).send({ body });
  if (res.status !== 201) throw new Error(`comment failed: ${JSON.stringify(res.body)}`);
  return res.body.comment as CommentDto;
}

/** The id of the newest notification of this user in this workspace. */
export async function firstNotificationId(token: string, ws: WorkspaceDto) {
  const res = await as(token).get(`/api/w/${ws.slug}/notifications?limit=1`);
  const id = (res.body.items as { id: string }[] | undefined)?.[0]?.id;
  if (!id) throw new Error(`no notification: ${JSON.stringify(res.body)}`);
  return id;
}

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

export async function makeProject(
  token: string,
  ws: WorkspaceDto,
  key = 'MOB',
  name = 'Mobile App',
) {
  const res = await as(token).post(`/api/w/${ws.slug}/projects`).send({ name, key });
  if (res.status !== 201) throw new Error(`project failed: ${JSON.stringify(res.body)}`);
  return res.body.project as ProjectDto;
}

/** Adds a label and returns the updated project (labels come back on the project). */
export async function makeLabel(token: string, ws: WorkspaceDto, key: string, name = 'Bug') {
  const res = await as(token)
    .post(`/api/w/${ws.slug}/projects/${key}/labels`)
    .send({ name, color: 'red' });
  if (res.status !== 201) throw new Error(`label failed: ${JSON.stringify(res.body)}`);
  return (res.body.labels as LabelDto[]).find((l) => l.name === name)!;
}

/**
 * Two companies. Use this in EVERY tenant test so leaks show up.
 * Their projects have DIFFERENT keys (AAA / BEE): with the same key, "A's slug + B's key"
 * would find A's own project and the probe would prove nothing.
 */
export async function twoTenants() {
  const make = async (ownerName: string, wsName: string, key: string) => {
    const owner = await registerUser(ownerName);
    const ws = await makeWorkspace(owner.token, wsName);
    const member = await addMember(owner.token, ws, 'member', `${wsName} member`);
    const invite = await makeInvite(owner.token, ws, { role: 'viewer' });
    const project = await makeProject(owner.token, ws, key, `${wsName} project`);
    const label = await makeLabel(owner.token, ws, key);
    const task = await makeTask(owner.token, ws, key, { title: `${wsName} task` });
    const comment = await makeComment(owner.token, ws, task.id, `${wsName} comment`);
    // The member joining via the owner's invite notified the owner (N7)
    const notificationId = await firstNotificationId(owner.token, ws);
    return {
      ...owner,
      ws,
      member,
      inviteId: invite.id,
      project,
      label,
      task,
      comment,
      notificationId,
    };
  };
  return {
    a: await make('Alice', 'A Corp', 'AAA'),
    b: await make('Bob', 'B Corp', 'BEE'),
  };
}

/**
 * One workspace with a user of each role, a spare Viewer ("target") to act on,
 * an outsider with no membership, an open viewer invite to revoke,
 * and project MOB (default columns) with one label.
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
  const project = await makeProject(owner.token, ws, 'MOB');
  const label = await makeLabel(owner.token, ws, 'MOB');
  // Reported by the MEMBER: members may delete only their own tasks (FR-TSK-05), so the
  // RBAC matrix can expect "not 403" for every role that has task:delete.
  const task = await makeTask(member.token, ws, 'MOB', { title: 'Fixture task' });
  // By the MEMBER too: only authors (and Admin+) may delete, so every allowed role gets a
  // non-403 (the member deletes it, admin/owner then get 404).
  const comment = await makeComment(member.token, ws, task.id, 'Fixture comment');
  return {
    ws,
    slug: ws.slug,
    owner,
    admin,
    member,
    viewer,
    target,
    outsider,
    inviteId: invite.id,
    project,
    label,
    task,
    comment,
    // The OWNER's (invite accepted, N7): other roles reading it get 404, never 403.
    notificationId: await firstNotificationId(owner.token, ws),
  };
}
export type Team = Awaited<ReturnType<typeof makeTeam>>;
