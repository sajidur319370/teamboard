/**
 * Demo data (database.md §10): one workspace "Acme Studio" (/w/acme) with a login per role,
 * a Scrum project (MOB) with two completed sprints, one running and one planned, and a
 * Kanban project (WEB).
 *
 * It calls the REAL services with an injectable clock (ctx.now), so every activity,
 * burndown delta, notification and frozen report looks exactly like real usage, and the
 * timeline is relative to TODAY: Sprint 3 is always mid-way when you open the demo.
 *
 *   npm run seed -w @teamboard/api                 # local (apps/api/.env)
 *   npm run seed -w @teamboard/api -- --reset      # delete the demo data first
 *   npm run seed -w @teamboard/api -- --perf       # + project PRF with 500 tasks (NFR-PERF)
 *   npm run seed:atlas -w @teamboard/api -- --reset   # production: see the guard below
 *
 * --reset deletes ONLY the demo: the demo users and the workspaces they own. It never
 * drops the database, so it is safe on a database that real people use.
 */
import { generateNKeysBetween } from 'fractional-indexing';
import { Types } from 'mongoose';
import { todayIn, type Priority, type Role, type StoryPoint } from '@teamboard/shared';
import { isProd } from '../src/config/env';
import { connectDb, disconnectDb } from '../src/db/connection';
import { syncAllIndexes } from '../src/db/indexes';
import {
  Activity,
  Comment,
  Invite,
  Membership,
  Notification,
  Project,
  Session,
  Sprint,
  Task,
  User,
  Workspace,
} from '../src/db/models';
import { hashPassword } from '../src/lib/password';
import { makeCtx, type Ctx } from '../src/types/ctx';
import { startNotifier } from '../src/notifications/fromEvents';
import { createComment } from '../src/modules/comments/comment.service';
import { createProject } from '../src/modules/projects/project.service';
import * as sprints from '../src/modules/sprints/sprint.service';
import { moveTask } from '../src/modules/tasks/move.service';
import { createTask } from '../src/modules/tasks/task.service';
import { createWorkspace, updateWorkspace } from '../src/modules/workspaces/workspace.service';

const args = new Set(process.argv.slice(2));
const RESET = args.has('--reset');
const PERF = args.has('--perf');
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const TZ = 'Asia/Dhaka'; // UTC+6 and no daylight saving
const SLUG = 'acme';

if (isProd && process.env.SEED_ALLOW_PROD !== 'yes') {
  console.error('Refusing to seed a production database without SEED_ALLOW_PROD=yes.');
  process.exit(1);
}

const DEMO = {
  owner: { email: 'owner@demo.teamboard.dev', name: 'Olivia Owner', color: 'purple' },
  admin: { email: 'admin@demo.teamboard.dev', name: 'Arif Admin', color: 'blue' },
  member: { email: 'member@demo.teamboard.dev', name: 'Mina Member', color: 'teal' },
  rahim: { email: 'rahim@demo.teamboard.dev', name: 'Rahim Uddin', color: 'orange' },
  viewer: { email: 'viewer@demo.teamboard.dev', name: 'Victor Viewer', color: 'gray' },
} as const;
type Who = keyof typeof DEMO;
const ROLE: Record<Who, Role> = {
  owner: 'owner',
  admin: 'admin',
  member: 'member',
  rahim: 'member',
  viewer: 'viewer',
};

// ---------------------------------------------------------------- the clock ----
const realNow = new Date();
const today = todayIn(TZ, realNow);
let clock = realNow;
const plusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysSince = (day: string) =>
  Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
/**
 * Set the clock to `day` at `hour`:`minute` in Dhaka, but never past the real now: the
 * running sprint must not get events from the future.
 */
function at(day: string, hour: number, minute = 0) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const t = new Date(`${day}T${hh}:${mm}:00+06:00`);
  clock = t < realNow ? t : new Date(realNow.getTime() - 60_000);
}

// A tiny seeded PRNG: the same demo every run.
let seed = 42;
const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const oid = (id: string) => new Types.ObjectId(id);

// ---------------------------------------------------------------- reset ----
async function resetDemo() {
  const demoUsers = await User.find({ email: { $in: Object.values(DEMO).map((d) => d.email) } })
    .select('_id')
    .lean();
  const userIds = demoUsers.map((u) => u._id);
  const taken = await Workspace.findOne({ slug: SLUG }).select('ownerId').lean();
  if (taken && !userIds.some((id) => id.equals(taken.ownerId))) {
    throw new Error(`/w/${SLUG} belongs to a real (non-demo) owner. Not touching it.`);
  }
  const owned = await Workspace.find({ ownerId: { $in: userIds } })
    .select('_id')
    .lean();
  for (const { _id: workspaceId } of owned) {
    await Notification.deleteMany({ workspaceId });
    await Activity.deleteMany({ workspaceId });
    await Comment.deleteMany({ workspaceId });
    await Task.deleteMany({ workspaceId });
    await Sprint.deleteMany({ workspaceId });
    await Project.deleteMany({ workspaceId });
    await Invite.deleteMany({ workspaceId });
    await Membership.deleteMany({ workspaceId });
    await Workspace.deleteOne({ _id: workspaceId });
  }
  // Memberships of demo users in OTHER workspaces (if someone invited them), then the users.
  await Membership.deleteMany({ userId: { $in: userIds } }).setOptions({
    skipTenantCheck: 'seed-reset',
  });
  await Session.deleteMany({ userId: { $in: userIds } });
  await User.deleteMany({ _id: { $in: userIds } });
  console.log(`  reset: ${owned.length} demo workspace(s), ${userIds.length} demo user(s) removed`);
}

// ---------------------------------------------------------------- data ----
const MOB_TASKS: [string, Priority, StoryPoint | null][] = [
  ['Sign in with email and password', 'high', 5],
  ['Remember me on this device', 'medium', 3],
  ['Forgot password flow', 'high', 5],
  ['Onboarding carousel', 'low', 3],
  ['Push notification permissions', 'medium', 2],
  ['Profile screen', 'medium', 3],
  ['Upload an avatar', 'low', 2],
  ['Dark mode toggle', 'low', 3],
  ['Offline banner', 'medium', 2],
  ['Crash reporting', 'high', 3],
  ['Home feed: list view', 'urgent', 8],
  ['Home feed: pull to refresh', 'medium', 2],
  ['Infinite scroll on the feed', 'medium', 5],
  ['Search: recent queries', 'low', 2],
  ['Search: results page', 'high', 5],
  ['Deep links into posts', 'medium', 3],
  ['Share sheet', 'low', 2],
  ['Settings: notification toggles', 'medium', 3],
  ['Settings: language picker', 'low', 2],
  ['Accessibility audit fixes', 'high', 5],
  ['App icon and splash screen', 'low', 1],
  ['Analytics events', 'medium', 3],
  ['Release checklist', 'none', 1],
  ['Fix login redirect loop', 'urgent', 3],
  ['Fix keyboard covering inputs', 'high', 2],
  ['Slow cold start on Android', 'high', 8],
  ['Image cache eviction', 'medium', 3],
  ['Rate limit the feed API', 'medium', 3],
  ['Error states for empty feed', 'low', 2],
  ['Tablet layout', 'low', 5],
  ['Biometric unlock', 'medium', 5],
  ['In-app feedback form', 'none', null],
  ['Privacy policy screen', 'none', 1],
  ['Terms acceptance on sign up', 'medium', 2],
  ['App store screenshots', 'low', null],
  ['Beta tester invite flow', 'medium', 3],
  ['Feature flags client', 'medium', 5],
  ['Localize date formats', 'low', 2],
  ['Retry failed uploads', 'high', 3],
  ['Clear cache button', 'none', 1],
  ['Rewrite networking layer', 'medium', 13],
  ['Pin posts to the top', 'low', 3],
  ['Reaction emoji picker', 'low', 3],
  ['Report a post', 'high', 3],
  ['Block a user', 'high', 3],
  ['Draft posts', 'medium', 5],
  ['Schedule posts', 'low', 5],
  ['Polls in posts', 'low', 8],
];
const WEB_TASKS: [string, Priority, string][] = [
  ['Hero section copy', 'high', 'To Do'], // WEB-1 stays in To Do (the E2E test moves it)
  ['Pricing page', 'high', 'In Progress'],
  ['Customer logos strip', 'medium', 'To Do'],
  ['Blog index', 'low', 'To Do'],
  ['Newsletter sign-up', 'medium', 'Review'],
  ['Cookie banner', 'urgent', 'Done'],
  ['Open Graph images', 'low', 'To Do'],
  ['Careers page', 'none', 'In Progress'],
  ['404 page', 'low', 'Done'],
  ['Lighthouse fixes', 'medium', 'Review'],
];
const COMMENTS = [
  'Looks good on staging 👍',
  'Can we get **one more** review before merging?',
  'Blocked on the API change, see the thread.',
  'I tried this on an old Android phone: still slow on first launch.',
  'Design is in Figma, link in the description.',
  'Moving this to next sprint if it slips again.',
  'Fixed in the latest build.',
  'Should we split this into two tasks?',
];
const GOALS = ['Accounts and onboarding', 'The home feed', 'Search and sharing', 'Polish for beta'];

// ---------------------------------------------------------------- main ----
await connectDb();
await syncAllIndexes();
startNotifier(); // createApp() does this for the server; the seed needs it too
if (RESET) await resetDemo();
if (await User.exists({ email: DEMO.owner.email })) {
  console.error('Demo data already exists. Run with --reset to recreate it.');
  await disconnectDb();
  process.exit(1);
}

const passwordHash = await hashPassword(PASSWORD);
const users = {} as Record<Who, { _id: Types.ObjectId }>;
for (const [who, d] of Object.entries(DEMO) as [Who, (typeof DEMO)[Who]][]) {
  users[who] = await User.create({
    email: d.email,
    name: d.name,
    passwordHash,
    timezone: TZ,
    avatarColor: d.color,
  });
}

// The workspace through the real service (activity + owner membership); the rest join
// directly (invites are for humans).
await createWorkspace(users.owner._id, { name: 'Acme Studio', slug: SLUG });
const workspaceId = (await Workspace.findOne({ slug: SLUG }).select('_id').lean())!._id;
const ctxOf = (who: Who): Ctx =>
  makeCtx({ userId: users[who]._id, workspaceId, role: ROLE[who], tz: TZ, now: () => clock });
await Membership.insertMany(
  (['admin', 'member', 'rahim', 'viewer'] as const).map((who) => ({
    workspaceId,
    userId: users[who]._id,
    role: ROLE[who],
  })),
);
const admin = ctxOf('admin');

// Sprint calendar, relative to today: S1, S2 done; S3 running (day 7 of 14); S4 planned.
const s3Start = plusDays(today, -6);
const span = (start: string) => ({ startDate: start, endDate: plusDays(start, 13) });
const S = [
  span(plusDays(s3Start, -28)),
  span(plusDays(s3Start, -14)),
  span(s3Start),
  span(plusDays(s3Start, 14)),
];

at(plusDays(S[0]!.startDate, -4), 9);
await updateWorkspace(ctxOf('owner'), { timezone: TZ });
const mob = await createProject(ctxOf('owner'), {
  name: 'Mobile App v2',
  key: 'MOB',
  description: 'Scrum: two-week sprints, story points, burndown.',
});
await createProject(ctxOf('owner'), {
  name: 'Marketing Site',
  key: 'WEB',
  description: 'Kanban: no sprints, just flow.',
});
const col = (name: string) => mob.columns.find((c) => c.name === name)!.id;

// MOB backlog: everyone files tasks over a few days.
const workers: Who[] = ['admin', 'member', 'rahim', 'owner'];
const assigneeOf = new Map<string, Who>();
const backlog: string[] = [];
for (const [i, [title, priority, storyPoints]] of MOB_TASKS.entries()) {
  at(plusDays(S[0]!.startDate, -3 + Math.floor(i / 20)), 10, i % 60);
  const assignee = workers[i % workers.length]!;
  const t = await createTask(ctxOf(pick(workers)), 'MOB', {
    title,
    priority,
    storyPoints,
    ...(i % 5 !== 4 && { assigneeIds: [String(users[assignee]._id)] }), // some unassigned
    ...(i % 7 === 0 && { dueDate: plusDays(today, (i % 3) - 2) }), // overdue / today / soon
    description: i % 4 === 0 ? `As a user I want **${title.toLowerCase()}**.` : '',
  });
  if (i % 5 !== 4) assigneeOf.set(t.id, assignee);
  backlog.push(t.id);
}

const move = (who: Who, taskId: string, column: string) =>
  moveTask(ctxOf(who), oid(taskId), {
    toColumnId: col(column),
    prevTaskId: null,
    nextTaskId: null,
  });
const by = (id: string) => assigneeOf.get(id) ?? 'admin';
const add = (sprintId: string, ids: string[]) =>
  sprints.setSprintTasks(admin, oid(sprintId), 'add', ids);

async function planSprint(n: number, day: string) {
  at(day, 16);
  return sprints.createSprint(admin, 'MOB', { ...S[n]!, goal: GOALS[n]! });
}

const started = new Set<string>();
const done: string[] = [];

/**
 * One sprint, day by day on working days: something starts, one or two things finish
 * (In Progress → Review → Done), comments, scope creep on day 3, a descope on day 4, a
 * reopened task on day 7. With `days`, it stops early (the running sprint).
 */
async function runSprint(
  n: number,
  sprintId: string,
  opts: { days?: number; beforeComplete?: () => Promise<string> } = {},
) {
  const { startDate, endDate } = S[n]!;
  at(startDate, 9, 30);
  await sprints.startSprint(admin, oid(sprintId));
  const inSprint = await Task.find({ workspaceId, sprintId: oid(sprintId) })
    .select('_id')
    .lean();
  const open = inSprint.map((t) => String(t._id));

  for (let d = 0; d < (opts.days ?? 14); d++) {
    const day = plusDays(startDate, d);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue; // weekend: the ideal line is flat too
    const next = open.find((id) => !started.has(id));
    if (next) {
      at(day, 10, 15);
      started.add(next);
      await move(by(next), next, 'In Progress');
    }
    const finish = d < 2 ? 0 : d % 3 === 0 ? 2 : 1; // a slow start, like real teams
    for (let k = 0; k < finish; k++) {
      const id = open.find((x) => started.has(x));
      if (!id) break;
      at(day, 14 + k, 20);
      await move(by(id), id, 'Review');
      at(day, 16 + k, 5);
      await move('admin', id, 'Done');
      open.splice(open.indexOf(id), 1);
      done.push(id);
    }
    if (d % 2 === 1 && open[0]) {
      at(day, 11, 40);
      const who = pick(['admin', 'member', 'rahim'] as const);
      await createComment(ctxOf(who), oid(open[0]), pick(COMMENTS));
    }
    if (d === 3 && backlog.length >= 2) {
      at(day, 12); // scope creep: two tasks join the running sprint (Admin+)
      const extra = backlog.splice(0, 2);
      await add(sprintId, extra);
      open.push(...extra);
    }
    if (d === 4 && open.length > 3) {
      at(day, 12, 30); // descoped back to the backlog
      const out = open.pop()!;
      await sprints.setSprintTasks(admin, oid(sprintId), 'remove', [out]);
      backlog.unshift(out);
    }
    if (d === 7) {
      const mine = new Set(inSprint.map((t) => String(t._id)));
      const again = [...done].reverse().find((id) => mine.has(id));
      if (again) {
        at(day, 9, 50); // a regression: reopened (the burndown goes UP that day)
        done.splice(done.indexOf(again), 1);
        await move(by(again), again, 'In Progress');
        open.unshift(again);
      }
    }
  }
  if (opts.days !== undefined) {
    // Still running: leave work in flight, like a real mid-sprint board.
    at(today, 9, 30);
    const [a1, a2, a3] = open;
    for (const id of [a1, a2, a3])
      if (id && !started.has(id)) await move(by(id), id, 'In Progress');
    if (a1) await move(by(a1), a1, 'Review');
    return;
  }
  const target = opts.beforeComplete ? await opts.beforeComplete() : 'backlog';
  at(endDate, 17, 30);
  await sprints.completeSprint(admin, oid(sprintId), target);
}

// Sprint 1 → done; leftovers to the backlog
const s1 = await planSprint(0, plusDays(S[0]!.startDate, -1));
await add(s1.id, backlog.splice(0, 10));
await runSprint(0, s1.id);

// Sprint 2 → done; leftovers carried into Sprint 3, planned just before Sprint 2 closes
const s2 = await planSprint(1, plusDays(S[1]!.startDate, -1));
await add(s2.id, backlog.splice(0, 11));
let s3Id = '';
await runSprint(1, s2.id, {
  beforeComplete: async () => {
    s3Id = (await planSprint(2, S[1]!.endDate)).id;
    return s3Id;
  },
});
console.log('  sprints 1–2: completed, reports frozen');

// Sprint 3: more work, started, and run up to today
at(plusDays(S[2]!.startDate, -1), 17);
await add(s3Id, backlog.splice(0, 8));
await runSprint(2, s3Id, { days: daysSince(S[2]!.startDate) + 1 });
console.log('  sprint 3: running');

// Sprint 4: planned, a few tasks lined up
const s4 = await planSprint(3, today);
await add(s4.id, backlog.splice(0, 5));

// WEB: a plain Kanban board. WEB-1 stays in To Do (the E2E test moves it).
const webCols = (await Project.findOne({ workspaceId, key: 'WEB' }).lean())!.columns;
for (const [i, [title, priority, column]] of WEB_TASKS.entries()) {
  const who: Who = i % 2 ? 'member' : 'rahim';
  at(plusDays(today, -10 + i), 11);
  const t = await createTask(ctxOf(who), 'WEB', {
    title,
    priority,
    assigneeIds: [String(users[who]._id)],
  });
  if (column !== 'To Do') {
    at(plusDays(today, -9 + i), 15);
    const target = webCols.find((c) => c.name === column)!;
    await moveTask(ctxOf(who), oid(t.id), {
      toColumnId: String(target._id),
      prevTaskId: null,
      nextTaskId: null,
    });
  }
}

// Mongoose stamped createdAt/updatedAt with the REAL time; give tasks their story's times.
const spans = await Activity.aggregate<{ _id: Types.ObjectId; first: Date; last: Date }>([
  { $match: { workspaceId, taskId: { $ne: null } } },
  { $group: { _id: '$taskId', first: { $min: '$createdAt' }, last: { $max: '$createdAt' } } },
]);
await Task.collection.bulkWrite(
  spans.map((s) => ({
    updateOne: {
      filter: { _id: s._id, workspaceId },
      update: { $set: { createdAt: s.first, updatedAt: s.last } },
    },
  })),
);

if (PERF) await seedPerf();

const counts = {
  tasks: await Task.countDocuments({ workspaceId }),
  activities: await Activity.countDocuments({ workspaceId }),
  comments: await Comment.countDocuments({ workspaceId }),
  notifications: await Notification.countDocuments({ workspaceId }),
};
console.log(`✅ Seeded /w/${SLUG}:`, counts);
console.log(
  `   Log in as owner@ / admin@ / member@ / viewer@demo.teamboard.dev with "${PASSWORD}"`,
);
await disconnectDb();

/** NFR-PERF: one project with 500 tasks over 4 columns, inserted directly (fast). */
async function seedPerf() {
  at(today, 8);
  const p = await createProject(ctxOf('owner'), {
    name: 'Performance check',
    key: 'PRF',
    description: '500 tasks for the NFR-PERF board check.',
  });
  const ranks = generateNKeysBetween(null, null, 125);
  await Task.insertMany(
    Array.from({ length: 500 }, (_, i) => ({
      workspaceId,
      projectId: oid(p.id),
      number: i + 1,
      title: `Load test task ${i + 1}`,
      columnId: oid(p.columns[i % 4]!.id),
      rank: ranks[Math.floor(i / 4)]!,
      reporterId: users.owner._id,
      watcherIds: [users.owner._id],
      assigneeIds: [users[workers[i % 4]!]._id],
      priority: pick(['urgent', 'high', 'medium', 'low', 'none'] as const),
      storyPoints: pick([1, 2, 3, 5, 8] as const),
      completedAt: i % 4 === 3 ? clock : null,
    })),
  );
  await Project.updateOne({ _id: oid(p.id), workspaceId }, { $set: { taskCounter: 500 } });
  console.log('  + PRF: 500 tasks (delete the project when you are done measuring)');
}
