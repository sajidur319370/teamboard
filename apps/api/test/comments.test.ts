import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import type { CommentDto } from '@teamboard/shared';
import { Activity, Comment, Task } from '../src/db/models';
import { encodeCursor } from '../src/lib/cursor';
import { as } from './helpers/auth';
import { makeComment, makeTask, makeTeam, type Team } from './helpers/tenants';
import { connect, disconnectAll, emitAck, nextEvent, startServer } from './helpers/sockets';

// FR-CMT-01..07, queries.md §9. makeTeam() already has one comment by the member on t.task.
const url = (t: Team, taskId = t.task.id) => `/api/w/${t.slug}/tasks/${taskId}/comments`;
const commentUrl = (t: Team, id: string) => `/api/w/${t.slug}/comments/${id}`;
const taskDoc = (t: Team) => Task.findOne({ _id: t.task.id, workspaceId: t.ws.id }).lean();
const list = async (t: Team, token: string, query = '') =>
  (await as(token).get(`${url(t)}${query}`)).body as {
    items: CommentDto[];
    nextCursor: string | null;
  };

describe('create (FR-CMT-01, FR-CMT-05)', () => {
  it('201 with the author, counts it on the task, and makes the author a watcher', async () => {
    const t = await makeTeam();
    const res = await as(t.admin.token).post(url(t)).send({ body: '  Fixed on **staging**  ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      comment: {
        id: expect.any(String),
        taskId: t.task.id,
        author: { id: t.admin.user.id, name: 'Arif Admin', avatarColor: expect.any(String) },
        body: 'Fixed on **staging**', // trimmed; Markdown is stored as written
        editedAt: null,
        createdAt: expect.any(String),
      },
      commentCount: 2,
    });
    const task = await taskDoc(t);
    expect(task!.commentCount).toBe(2);
    expect(task!.watcherIds.map(String)).toContain(t.admin.user.id);
    expect(task!.version).toBe(1); // a comment isn't a task edit: no VERSION_CONFLICT for editors
  });

  it('writes comment.created with a task snapshot and a 100-char excerpt', async () => {
    const t = await makeTeam();
    const c = await makeComment(t.owner.token, t.ws, t.task.id, 'x'.repeat(300));
    const a = await Activity.findOne({ workspaceId: t.ws.id, entityId: c.id }).lean();
    expect(a).toMatchObject({ action: 'comment.created', entityType: 'comment' });
    expect(String(a!.taskId)).toBe(t.task.id);
    expect(a!.metadata).toEqual({
      task: { key: 'MOB', number: t.task.number, title: 'Fixture task' },
      excerpt: `${'x'.repeat(99)}…`,
    });
  });

  it('rejects empty / whitespace / too long bodies, and strips control characters', async () => {
    const t = await makeTeam();
    for (const body of ['', '   ', 'x'.repeat(5001)]) {
      const res = await as(t.member.token).post(url(t)).send({ body });
      expect(res.status, JSON.stringify(body).slice(0, 20)).toBe(400);
    }
    const ok = await makeComment(t.member.token, t.ws, t.task.id, 'a\u0000b\u0007c\n<img src=x>');
    expect(ok.body).toBe('abc\n<img src=x>'); // HTML stays text; react-markdown never renders it
  });

  it('E2: commenting on a task deleted meanwhile is a 404 (and counts nothing)', async () => {
    const t = await makeTeam();
    await as(t.member.token).delete(`/api/w/${t.slug}/tasks/${t.task.id}`).expect(204);
    const res = await as(t.member.token).post(url(t)).send({ body: 'too late' });
    expect(res.status).toBe(404);
    expect(await Comment.countDocuments({ workspaceId: t.ws.id })).toBe(0);
  });

  it('archived projects are read-only: no new comments, edits or deletes (BR-11)', async () => {
    const t = await makeTeam();
    await as(t.owner.token).post(`/api/w/${t.slug}/projects/MOB/archive`).expect(200);
    const tries = [
      as(t.member.token).post(url(t)).send({ body: 'hi' }),
      as(t.member.token).patch(commentUrl(t, t.comment.id)).send({ body: 'edited' }),
      as(t.member.token).delete(commentUrl(t, t.comment.id)),
    ];
    for (const res of await Promise.all(tries)) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
    }
    expect((await taskDoc(t))!.commentCount).toBe(1);
    // ...but reading still works
    expect((await list(t, t.viewer.token)).items).toHaveLength(1);
  });

  it('the watcher cap holds: the 51st person can still comment, but is not added', async () => {
    const t = await makeTeam();
    const full = Array.from({ length: 50 }, () => new Types.ObjectId());
    await Task.updateOne({ _id: t.task.id, workspaceId: t.ws.id }, { $set: { watcherIds: full } });
    await makeComment(t.admin.token, t.ws, t.task.id);
    const task = await taskDoc(t);
    expect(task!.watcherIds).toHaveLength(50);
    expect(task!.commentCount).toBe(2);
  });

  it('commentCount stays exact under 20 parallel comments (same-transaction $inc)', async () => {
    const t = await makeTeam();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        as(i % 2 ? t.member.token : t.admin.token)
          .post(url(t))
          .send({ body: `parallel ${i}` }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
    const counts = results.map((r) => r.body.commentCount as number).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: 20 }, (_, i) => i + 2)); // each saw a distinct total
    expect((await taskDoc(t))!.commentCount).toBe(21);
    expect(await Comment.countDocuments({ workspaceId: t.ws.id, taskId: t.task.id })).toBe(21);
  });
});

describe('list (FR-CMT-04)', () => {
  it('oldest first, cursor-paginated, no gaps or repeats, ties broken by _id', async () => {
    const t = await makeTeam();
    await Comment.deleteMany({ workspaceId: t.ws.id });
    // 7 comments, several in the SAME millisecond: only (createdAt, _id) orders them.
    const base = Date.UTC(2026, 0, 5, 10);
    const docs = await Comment.insertMany(
      [0, 0, 0, 1, 1, 2, 3].map((ms, i) => ({
        workspaceId: t.ws.id,
        projectId: t.project.id,
        taskId: t.task.id,
        authorId: t.member.user.id,
        body: `c${i}`,
        createdAt: new Date(base + ms),
      })),
    );
    const expected = docs
      .map((d) => ({ id: String(d._id), t: d.createdAt.getTime() }))
      .sort((a, b) => a.t - b.t || a.id.localeCompare(b.id))
      .map((d) => d.id);

    const seen: string[] = [];
    let cursor: string | null = '';
    let pages = 0;
    do {
      const page: { items: CommentDto[]; nextCursor: string | null } = await list(
        t,
        t.viewer.token, // comment:view is Viewer+
        `?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      seen.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(seen).toEqual(expected);
    expect(pages).toBe(4); // 2+2+2+1: the last page says nextCursor: null
  });

  it('defaults to 50 per page; limit is capped at 100', async () => {
    const t = await makeTeam();
    await Comment.insertMany(
      Array.from({ length: 60 }, (_, i) => ({
        workspaceId: t.ws.id,
        projectId: t.project.id,
        taskId: t.task.id,
        authorId: t.member.user.id,
        body: `c${i}`,
      })),
    );
    const page = await list(t, t.member.token);
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect((await as(t.member.token).get(`${url(t)}?limit=101`)).status).toBe(400);
  });

  it('a garbage or tampered cursor is a 400 INVALID_CURSOR, never a 500', async () => {
    const t = await makeTeam();
    const bad = [
      'nope',
      Buffer.from('{"t":"yesterday","id":"x"}').toString('base64url'),
      Buffer.from('null').toString('base64url'),
      Buffer.from(JSON.stringify({ t: new Date().toISOString(), id: { $gt: '' } })).toString(
        'base64url',
      ),
    ];
    for (const cursor of bad) {
      const res = await as(t.member.token).get(`${url(t)}?cursor=${cursor}`);
      expect(res.status, cursor).toBe(400);
      expect(res.body.error.code, cursor).toBe('INVALID_CURSOR');
    }
    const weird = await as(t.member.token).get(`${url(t)}?cursor=a.b`); // not base64url at all
    expect(weird.status).toBe(400);
  });

  it("a deleted author shows as 'Former user' (no crash, no N+1)", async () => {
    const t = await makeTeam();
    // authorId is immutable in the schema, so go around Mongoose
    await Comment.collection.updateOne(
      { _id: new Types.ObjectId(t.comment.id) },
      { $set: { authorId: new Types.ObjectId() } },
    );
    const page = await list(t, t.member.token);
    expect(page.items[0]!.author).toMatchObject({ name: 'Former user', avatarColor: 'gray' });
  });

  it('a task in another project of the same workspace has its own thread', async () => {
    const t = await makeTeam();
    const other = await makeTask(t.member.token, t.ws, 'MOB', { title: 'Other' });
    expect((await list(t, t.member.token)).items).toHaveLength(1);
    const res = await as(t.member.token).get(url(t, other.id));
    expect(res.body).toEqual({ items: [], nextCursor: null });
    expect((await as(t.member.token).get(url(t, String(new Types.ObjectId())))).status).toBe(404);
  });
});

describe('edit (FR-CMT-02)', () => {
  it('the author edits: editedAt is set and the body cleaned', async () => {
    const t = await makeTeam();
    const res = await as(t.member.token)
      .patch(commentUrl(t, t.comment.id))
      .send({ body: ' Updated ' });
    expect(res.status).toBe(200);
    expect(res.body.comment).toMatchObject({ id: t.comment.id, body: 'Updated' });
    expect(res.body.comment.editedAt).toEqual(expect.any(String));
  });

  it('the same text again is not an edit (no "(edited)" marker)', async () => {
    const t = await makeTeam();
    const res = await as(t.member.token)
      .patch(commentUrl(t, t.comment.id))
      .send({ body: 'Fixture comment' });
    expect(res.status).toBe(200);
    expect(res.body.comment.editedAt).toBeNull();
  });

  it("nobody edits someone else's words, not even the Owner (403)", async () => {
    const t = await makeTeam();
    for (const who of [t.admin, t.owner]) {
      const res = await as(who.token).patch(commentUrl(t, t.comment.id)).send({ body: 'mine now' });
      expect(res.status).toBe(403);
    }
    const [c] = (await list(t, t.member.token)).items;
    expect(c).toMatchObject({ body: 'Fixture comment', editedAt: null });
  });

  it('unknown comment → 404', async () => {
    const t = await makeTeam();
    const res = await as(t.member.token)
      .patch(commentUrl(t, String(new Types.ObjectId())))
      .send({ body: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('delete (FR-CMT-03)', () => {
  it('the author deletes their own: hard delete, count down, comment.deleted logged', async () => {
    const t = await makeTeam();
    const res = await as(t.member.token).delete(commentUrl(t, t.comment.id));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ commentCount: 0 });
    expect(await Comment.exists({ _id: t.comment.id, workspaceId: t.ws.id })).toBeNull();
    expect((await taskDoc(t))!.commentCount).toBe(0);
    const a = await Activity.findOne({ workspaceId: t.ws.id, action: 'comment.deleted' }).lean();
    expect(a!.metadata).toEqual({
      task: { key: 'MOB', number: t.task.number, title: 'Fixture task' },
    });
  });

  it("a Member can't delete someone else's comment; an Admin can (moderation)", async () => {
    const t = await makeTeam();
    const adminsComment = await makeComment(t.admin.token, t.ws, t.task.id, "admin's");
    const denied = await as(t.member.token).delete(commentUrl(t, adminsComment.id));
    expect(denied.status).toBe(403);
    expect(await Comment.exists({ _id: adminsComment.id, workspaceId: t.ws.id })).not.toBeNull();

    const ok = await as(t.admin.token).delete(commentUrl(t, t.comment.id)); // the member's
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ commentCount: 1 });
  });

  it('double delete: exactly one succeeds and the count drops once', async () => {
    const t = await makeTeam();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => as(t.member.token).delete(commentUrl(t, t.comment.id))),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 404, 404, 404, 404]);
    expect((await taskDoc(t))!.commentCount).toBe(0);
  });
});

describe('cascades', () => {
  it('deleting a task deletes its comments', async () => {
    const t = await makeTeam();
    const other = await makeTask(t.member.token, t.ws, 'MOB');
    await makeComment(t.member.token, t.ws, other.id);
    await as(t.member.token).delete(`/api/w/${t.slug}/tasks/${t.task.id}`).expect(204);
    const left = await Comment.find({ workspaceId: t.ws.id }).lean();
    expect(left.map((c) => String(c.taskId))).toEqual([other.id]);
  });

  it('deleting a project deletes its comments', async () => {
    const t = await makeTeam();
    await as(t.owner.token)
      .delete(`/api/w/${t.slug}/projects/MOB`)
      .send({ confirmKey: 'MOB' })
      .expect(204);
    expect(await Comment.countDocuments({ workspaceId: t.ws.id })).toBe(0);
  });
});

describe('live (FR-CMT-06)', () => {
  let srv: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    srv = await startServer();
  });
  afterEach(() => disconnectAll());
  afterAll(async () => {
    await srv.close();
  });

  it('created / updated / deleted reach the board room with the new totals', async () => {
    const t = await makeTeam();
    const s = await connect(srv.port, t.viewer.token);
    await emitAck(s, 'workspace:join', { workspaceId: t.ws.id });
    await emitAck(s, 'board:join', { projectId: t.project.id });

    const created = nextEvent<Record<string, unknown>>(s, 'comment:created');
    const res = await as(t.admin.token)
      .post(url(t))
      .set('X-Client-Mutation-Id', 'cm-1')
      .send({ body: 'live!' });
    expect(await created).toMatchObject({
      workspaceId: t.ws.id,
      projectId: t.project.id,
      actorId: t.admin.user.id,
      clientMutationId: 'cm-1', // the sending tab ignores its own echo (FR-RT-08)
      taskId: t.task.id,
      commentCount: 2,
      comment: res.body.comment,
    });

    const updated = nextEvent<{ comment: CommentDto }>(s, 'comment:updated');
    await as(t.admin.token).patch(commentUrl(t, res.body.comment.id)).send({ body: 'edited' });
    expect((await updated).comment).toMatchObject({ body: 'edited', editedAt: expect.any(String) });

    const deleted = nextEvent(s, 'comment:deleted');
    await as(t.admin.token).delete(commentUrl(t, res.body.comment.id));
    expect(await deleted).toMatchObject({
      taskId: t.task.id,
      commentId: res.body.comment.id,
      commentCount: 1,
    });
  });
});

// Keep encodeCursor's import honest: a cursor made for one task is just a position, so
// using it on another task is harmless (it filters by taskId too).
describe('cursor scope', () => {
  it("a cursor from another task's thread only sets a position", async () => {
    const t = await makeTeam();
    const cursor = encodeCursor({ createdAt: new Date(0), _id: new Types.ObjectId() });
    const page = await list(t, t.member.token, `?cursor=${cursor}`);
    expect(page.items.map((c) => c.id)).toEqual([t.comment.id]);
  });
});
