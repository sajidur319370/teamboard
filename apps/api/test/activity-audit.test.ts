import { describe, expect, it } from 'vitest';
import { ACTIVITY_ACTIONS, type ActivityDto } from '@teamboard/shared';
import { Activity } from '../src/db/models';
import { PASSWORD, as } from './helpers/auth';
import {
  addMember,
  makeComment,
  makeInvite,
  makeProject,
  makeTask,
  makeWorkspace,
} from './helpers/tenants';
import { registerUser } from './helpers/auth';

// FR-ACT-01: every action in the catalog is written by SOME endpoint. A scripted tour of the
// whole API; if a refactor drops an Activity.create, the failure names the missing action.
// Sprint actions arrive on Day 18 and are excluded until then.
describe('activity audit', () => {
  it('every non-sprint action in ACTIVITY_ACTIONS is written by some endpoint', async () => {
    const owner = await registerUser('Olivia Owner');
    const ws = await makeWorkspace(owner.token, 'Audit Inc'); // workspace.created
    const o = as(owner.token);
    const w = `/api/w/${ws.slug}`;
    await o.patch(w).send({ name: 'Audit Corp' }).expect(200); // workspace.updated

    const admin = await addMember(owner.token, ws, 'admin', 'Arif'); // invite.created, member.joined
    const member = await addMember(owner.token, ws, 'member', 'Rahim');
    const leaver = await addMember(owner.token, ws, 'member', 'Lena');
    const removed = await addMember(owner.token, ws, 'viewer', 'Remy');
    const spare = await makeInvite(owner.token, ws, { role: 'viewer' });
    await o.delete(`${w}/invites/${spare.id}`).expect(204); // invite.revoked
    await o.patch(`${w}/members/${member.user.id}`).send({ role: 'viewer' }).expect(200); // member.role_changed
    await o.patch(`${w}/members/${member.user.id}`).send({ role: 'member' }).expect(200);
    await o.delete(`${w}/members/${removed.user.id}`).expect(204); // member.removed
    await as(leaver.token).post(`${w}/leave`).expect(204); // member.left

    const project = await makeProject(owner.token, ws, 'AUD'); // project.created
    const p = `${w}/projects/AUD`;
    await o.patch(p).send({ name: 'Audit board' }).expect(200); // project.updated
    const col = await o.post(`${p}/columns`).send({ name: 'QA', category: 'in_progress' }); // column.created
    expect(col.status).toBe(201);
    const qa = (col.body.columns as { id: string; name: string }[]).find((c) => c.name === 'QA')!;
    await o.patch(`${p}/columns/${qa.id}`).send({ name: 'Testing' }).expect(200); // column.renamed
    const ids = (col.body.columns as { id: string }[]).map((c) => c.id);
    await o
      .put(`${p}/columns/order`)
      .send({ columnIds: [...ids].reverse() })
      .expect(200); // column.reordered
    await o.delete(`${p}/columns/${qa.id}`).send({}).expect(200); // column.deleted (empty)

    const m = as(member.token);
    const task = await makeTask(member.token, ws, 'AUD', { title: 'Audit me' }); // task.created
    const t = `${w}/tasks/${task.id}`;
    await m.patch(t).send({ priority: 'high' }).expect(200); // task.updated
    await m
      .patch(t)
      .send({ assigneeIds: [admin.user.id] })
      .expect(200); // task.assigned
    await m.patch(t).send({ assigneeIds: [] }).expect(200); // task.unassigned
    const done = project.columns.find((c) => c.category === 'done')!;
    const todo = project.columns.find((c) => c.category === 'todo')!;
    const move = (toColumnId: string) =>
      m.patch(`${t}/move`).send({ toColumnId, prevTaskId: null, nextTaskId: null }).expect(200);
    await move(done.id); // task.moved + task.completed
    await move(todo.id); // task.moved + task.reopened
    const c = await makeComment(member.token, ws, task.id); // comment.created
    await m.delete(`${w}/comments/${c.id}`).expect(200); // comment.deleted
    await m.delete(t).expect(204); // task.deleted

    await o.post(`${p}/archive`).expect(200); // project.archived
    await o.post(`${p}/unarchive`).expect(200); // project.unarchived
    await makeProject(owner.token, ws, 'DEL');
    await o.delete(`${w}/projects/DEL`).send({ confirmKey: 'DEL' }).expect(204); // project.deleted
    await o
      .post(`${w}/transfer-ownership`)
      .send({ userId: admin.user.id, password: PASSWORD })
      .expect(204); // ownership.transferred

    const written = new Set(await Activity.distinct('action', { workspaceId: ws.id }));
    const expected = ACTIVITY_ACTIONS.filter(
      (a) => !a.startsWith('sprint.') && !a.includes('_sprint'),
    );
    expect(expected.filter((a) => !written.has(a))).toEqual([]); // prints exactly what's missing

    // ...and the workspace feed can show all of it, with name snapshots where people are named.
    const feed = await as(admin.token).get(`${w}/activities?limit=100`).expect(200);
    const items = feed.body.items as ActivityDto[];
    const byAction = (a: string) => items.find((x) => x.action === a)!;
    expect(byAction('member.removed').metadata).toMatchObject({ user: { name: 'Remy' } });
    expect(byAction('member.role_changed').metadata).toMatchObject({ user: { name: 'Rahim' } });
    expect(byAction('task.assigned').metadata).toMatchObject({ user: { name: 'Arif' } });
    expect(byAction('ownership.transferred').metadata).toMatchObject({
      from: { name: 'Olivia Owner' },
      to: { name: 'Arif' },
    });
    expect(byAction('project.archived').metadata).toEqual({ name: 'Audit board', key: 'AUD' });
  });
});
