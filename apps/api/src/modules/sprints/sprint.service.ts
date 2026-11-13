import type { Types } from 'mongoose';
import {
  PRIORITIES,
  ROLE_LEVEL,
  todayIn,
  validSprintRange,
  type BacklogResponse,
  type CreateSprintInput,
  type SprintState,
  type TaskCardDto,
  type UpdateSprintInput,
} from '@teamboard/shared';
import { Activity, CARD_FIELDS, Project, Sprint, Task } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { oid } from '../../lib/ids';
import { activity } from '../../events/activity';
import { publish } from '../../events/publish';
import type { Ctx } from '../../types/ctx';
import { assertWritable, findProject } from '../projects/project.helpers';
import { toTaskCard } from '../tasks/task.dto';
import { lockSprint, sprintScopeActivity, touchSprint } from './sprint.helpers';
import { toSprintDto } from './sprint.dto';

const sprintRef = (s: { name: string; number: number }) => ({ name: s.name, number: s.number });
const sumPoints = (ts: { storyPoints?: number | null }[]) =>
  ts.reduce((n, t) => n + (t.storyPoints ?? 0), 0);

/** A sprint of this workspace + its (writable) project, or 404/409. */
async function loadSprint(ctx: Ctx, sprintId: Types.ObjectId) {
  const sprint = await Sprint.findOne({ _id: sprintId, workspaceId: ctx.workspaceId }).lean();
  if (!sprint) throw notFound();
  const project = await Project.findOne({ _id: sprint.projectId, workspaceId: ctx.workspaceId })
    .select('key archivedAt')
    .lean();
  if (!project) throw notFound();
  return { sprint, project };
}

const stateOrder: Record<string, number> = { active: 0, planned: 1, completed: 2 };

/** Active, then planned by start date, then completed (newest first). */
export async function listSprints(ctx: Ctx, key: string, state?: SprintState) {
  const p = await findProject(ctx, key);
  const rows = await Sprint.find({
    workspaceId: ctx.workspaceId,
    projectId: p._id,
    ...(state && { state }),
  })
    .select('-report -scopeSnapshot.taskIds')
    .lean();
  rows.sort(
    (a, b) =>
      stateOrder[a.state]! - stateOrder[b.state]! ||
      (a.state === 'completed'
        ? b.completedAt!.getTime() - a.completedAt!.getTime()
        : a.startDate.localeCompare(b.startDate)),
  );
  return rows.map(toSprintDto);
}

/** FR-SPR-01: "Sprint N" from an atomic per-project counter, like task numbers. */
export async function createSprint(ctx: Ctx, key: string, input: CreateSprintInput) {
  const p = await Project.findOneAndUpdate(
    { workspaceId: ctx.workspaceId, key, archivedAt: null },
    { $inc: { sprintCounter: 1 } },
    { returnDocument: 'after', projection: { sprintCounter: 1 } },
  ).lean();
  if (!p) {
    assertWritable(await findProject(ctx, key)); // archived → 409, missing → 404
    throw notFound();
  }

  const sprint = await withTransaction(async (session) => {
    const [s] = await Sprint.create(
      [
        {
          workspaceId: ctx.workspaceId,
          projectId: p._id,
          number: p.sprintCounter,
          name: input.name ?? `Sprint ${p.sprintCounter}`,
          goal: input.goal,
          startDate: input.startDate,
          endDate: input.endDate,
          createdBy: ctx.userId,
        },
      ],
      { session },
    );
    await Activity.create(
      [
        activity(
          ctx,
          'sprint.created',
          { sprint: sprintRef(s!) },
          { projectId: p._id, sprintId: s!._id },
        ),
      ],
      { session },
    );
    return s!.toObject();
  });
  const dto = toSprintDto(sprint);
  await publish(ctx, [{ type: 'sprint.changed', kind: 'created', projectId: p._id, sprint: dto }]);
  return dto;
}

/** FR-SPR-02: planned → anything; active → name, goal, end date; completed → read-only. */
export async function updateSprint(ctx: Ctx, sprintId: Types.ObjectId, input: UpdateSprintInput) {
  const { sprint, project } = await loadSprint(ctx, sprintId);
  assertWritable(project);
  if (sprint.state === 'completed') {
    throw conflict('INVALID_SPRINT_STATE', 'A completed sprint is read-only.');
  }
  if (sprint.state === 'active' && input.startDate !== undefined) {
    throw conflict('INVALID_SPRINT_STATE', "A running sprint's start date can't change.");
  }
  // The schema checks the range only when BOTH dates are sent; check the merged result.
  const startDate = input.startDate ?? sprint.startDate;
  const endDate = input.endDate ?? sprint.endDate;
  if (!validSprintRange(startDate, endDate)) {
    throw badRequest('INVALID_DATES', 'End must be 1–28 days after start.');
  }

  const updated = await Sprint.findOneAndUpdate(
    // CAS on state: a start/complete in between can't be overwritten by stale rules
    { _id: sprintId, workspaceId: ctx.workspaceId, state: sprint.state },
    { $set: input, $inc: { lock: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!updated) throw conflict('INVALID_SPRINT_STATE', 'The sprint changed meanwhile. Try again.');
  const dto = toSprintDto(updated);
  await publish(ctx, [
    { type: 'sprint.changed', kind: 'updated', projectId: updated.projectId, sprint: dto },
  ]);
  return dto;
}

/**
 * FR-SPR-04 / queries.md §10.3: move tasks between the backlog and a sprint.
 * Member+ for planned sprints, Admin+ for the active one (scope changes are deliberate).
 */
export async function setSprintTasks(
  ctx: Ctx,
  sprintId: Types.ObjectId,
  action: 'add' | 'remove',
  taskIds: string[],
) {
  const { sprint, project } = await loadSprint(ctx, sprintId);
  assertWritable(project);
  const isAdmin = ctx.roleLevel >= ROLE_LEVEL.admin;
  if (sprint.state === 'active' && !isAdmin) {
    throw forbidden('FORBIDDEN', 'Only Admins can change the scope of an active sprint.');
  }
  if (sprint.state === 'completed') {
    throw conflict('INVALID_SPRINT_STATE', 'A completed sprint is read-only.');
  }

  const changed = await withTransaction(async (session) => {
    // Lock + re-check the state in the SAME transaction (it may have started meanwhile).
    const fresh = await touchSprint(
      ctx,
      sprintId,
      isAdmin ? ['planned', 'active'] : ['planned'],
      session,
    );

    const tasks = await Task.find({
      _id: { $in: taskIds.map(oid) },
      workspaceId: ctx.workspaceId,
      projectId: sprint.projectId, // other projects' ids are silently ignored
      ...(action === 'add'
        ? { sprintId: { $ne: sprintId }, completedAt: null } // done work can't be planned
        : { sprintId }),
    })
      .select('_id number title storyPoints completedAt sprintId')
      .session(session)
      .lean();

    if (action === 'add') {
      // BR-09: one sprint at a time. Taking a task out of ANOTHER sprint locks that one too
      // (it might be starting right now), and an active one must be left explicitly.
      const sources = [...new Set(tasks.flatMap((t) => (t.sprintId ? [String(t.sprintId)] : [])))];
      for (const src of sources) {
        const s = await lockSprint(ctx, oid(src), session);
        if (s?.state === 'active') {
          throw conflict('TASK_IN_ACTIVE_SPRINT', 'Remove the task from the active sprint first.');
        }
      }
    }
    if (tasks.length === 0) return [];

    await Task.updateMany(
      { _id: { $in: tasks.map((t) => t._id) }, workspaceId: ctx.workspaceId },
      { $set: { sprintId: action === 'add' ? sprintId : null }, $inc: { version: 1 } },
      { session },
    );
    if (fresh.state === 'active') {
      // FR-SPR-07: scope changes of a running sprint are burndown events.
      const sign = action === 'add' ? 1 : -1;
      await Activity.insertMany(
        tasks.map((t) => sprintScopeActivity(ctx, t, project.key, sprint.projectId, fresh, sign)),
        { session },
      );
    }
    return tasks.map((t) => String(t._id));
  });

  if (changed.length) {
    await publish(ctx, [
      {
        type: 'tasks.sprintChanged',
        projectId: sprint.projectId,
        taskIds: changed,
        sprintId: action === 'add' ? String(sprintId) : null,
      },
    ]);
  }
  return { taskIds: changed };
}

/** Distinct assignees of a sprint's tasks (N9 recipients). */
async function sprintAssignees(ctx: Ctx, projectId: Types.ObjectId, sprintId: Types.ObjectId) {
  const ids = await Task.find({ workspaceId: ctx.workspaceId, projectId, sprintId }).distinct(
    'assigneeIds',
  );
  return ids.map(String);
}

/** FR-SPR-05/06, queries.md §10.2: snapshot the scope; one active sprint per project. */
export async function startSprint(ctx: Ctx, sprintId: Types.ObjectId) {
  const { project } = await loadSprint(ctx, sprintId);
  assertWritable(project);

  const started = await withTransaction(async (session) => {
    const sprint = await Sprint.findOne({
      _id: sprintId,
      workspaceId: ctx.workspaceId,
      state: 'planned',
    })
      .session(session)
      .lean();
    if (!sprint) throw conflict('INVALID_SPRINT_STATE', 'Only a planned sprint can be started.');

    const tasks = await Task.find({
      workspaceId: ctx.workspaceId,
      projectId: sprint.projectId,
      sprintId,
    })
      .select('_id storyPoints completedAt')
      .session(session)
      .lean();
    const done = tasks.filter((t) => t.completedAt);
    const today = todayIn(ctx.tz, ctx.now());

    const updated = await Sprint.findOneAndUpdate(
      { _id: sprintId, workspaceId: ctx.workspaceId, state: 'planned' },
      {
        $set: {
          state: 'active',
          startedAt: ctx.now(),
          startDate: sprint.startDate > today ? today : sprint.startDate, // FR-SPR-05
          scopeSnapshot: {
            taskIds: tasks.map((t) => t._id),
            totalTasks: tasks.length,
            totalPoints: sumPoints(tasks),
            doneTasks: done.length, // D4: already-done work isn't "remaining"
            donePoints: sumPoints(done),
            takenAt: ctx.now(),
          },
        },
        $inc: { lock: 1 },
      },
      { returnDocument: 'after', session },
    ).lean(); // E11000 one_active_sprint_per_project → 409 ACTIVE_SPRINT_EXISTS (E18)
    if (!updated) throw conflict('INVALID_SPRINT_STATE', 'Only a planned sprint can be started.');

    await Activity.create(
      [
        activity(
          ctx,
          'sprint.started',
          { sprint: sprintRef(sprint) },
          { projectId: sprint.projectId, sprintId },
        ),
      ],
      { session },
    );
    return updated;
  });

  const dto = toSprintDto(started);
  await publish(ctx, [
    {
      type: 'sprint.changed',
      kind: 'started',
      projectId: started.projectId,
      sprint: dto,
      projectKey: project.key,
      assigneeIds: await sprintAssignees(ctx, started.projectId, sprintId),
    },
  ]);
  return dto;
}

/** FR-SPR-08, queries.md §10.4: carry unfinished work over, freeze the report, close. */
export async function completeSprint(
  ctx: Ctx,
  sprintId: Types.ObjectId,
  carryOverTo: 'backlog' | string,
) {
  const { project } = await loadSprint(ctx, sprintId);
  assertWritable(project);
  const target = carryOverTo === 'backlog' ? null : oid(carryOverTo);
  if (target?.equals(sprintId)) {
    throw badRequest(
      'INVALID_SPRINT',
      'Carry-over target must be a planned sprint of this project.',
    );
  }

  const result = await withTransaction(async (session) => {
    const sprint = await Sprint.findOne({
      _id: sprintId,
      workspaceId: ctx.workspaceId,
      state: 'active',
    })
      .session(session)
      .lean();
    if (!sprint) throw conflict('INVALID_SPRINT_STATE', 'Only the active sprint can be completed.');
    if (target) {
      const ok = await lockSprint(ctx, target, session, ['planned']);
      if (!ok || !ok.projectId.equals(sprint.projectId)) {
        throw badRequest(
          'INVALID_SPRINT',
          'Carry-over target must be a planned sprint of this project.',
        );
      }
    }

    const inSprint = await Task.find({
      workspaceId: ctx.workspaceId,
      projectId: sprint.projectId,
      sprintId,
    })
      .select('_id completedAt assigneeIds')
      .session(session)
      .lean();
    const unfinished = inSprint.filter((t) => !t.completedAt);

    // 1. Freeze the report BEFORE moving unfinished tasks out (Day 19: buildSprintReport).
    const report = null;

    // 2. Carry over: unfinished tasks → backlog or the chosen planned sprint.
    if (unfinished.length) {
      await Task.updateMany(
        { _id: { $in: unfinished.map((t) => t._id) }, workspaceId: ctx.workspaceId },
        { $set: { sprintId: target }, $inc: { version: 1 } },
        { session },
      );
    }

    // 3. Close.
    const closed = await Sprint.findOneAndUpdate(
      { _id: sprintId, workspaceId: ctx.workspaceId, state: 'active' },
      { $set: { state: 'completed', completedAt: ctx.now(), report }, $inc: { lock: 1 } },
      { returnDocument: 'after', session },
    ).lean();
    await Activity.create(
      [
        activity(
          ctx,
          'sprint.completed',
          {
            sprint: sprintRef(sprint),
            completedTasks: inSprint.length - unfinished.length,
            carriedOverTasks: unfinished.length,
          },
          { projectId: sprint.projectId, sprintId },
        ),
      ],
      { session },
    );
    return {
      closed: closed!,
      movedIds: unfinished.map((t) => String(t._id)),
      assigneeIds: [...new Set(inSprint.flatMap((t) => t.assigneeIds.map(String)))],
    };
  });

  const dto = toSprintDto(result.closed);
  await publish(ctx, [
    {
      type: 'sprint.changed',
      kind: 'completed',
      projectId: result.closed.projectId,
      sprint: dto,
      projectKey: project.key,
      assigneeIds: result.assigneeIds,
    },
    ...(result.movedIds.length
      ? [
          {
            type: 'tasks.sprintChanged' as const,
            projectId: result.closed.projectId,
            taskIds: result.movedIds,
            sprintId: target ? String(target) : null,
          },
        ]
      : []),
  ]);
  return { sprint: dto, carriedOver: result.movedIds.length };
}

/** FR-SPR-10: planned only; its tasks return to the backlog. */
export async function deleteSprint(ctx: Ctx, sprintId: Types.ObjectId) {
  const { project } = await loadSprint(ctx, sprintId);
  assertWritable(project);

  const result = await withTransaction(async (session) => {
    // The delete itself writes the sprint: it can't interleave with a start (D10).
    const s = await Sprint.findOneAndDelete(
      { _id: sprintId, workspaceId: ctx.workspaceId, state: 'planned' },
      { session },
    ).lean();
    if (!s) throw conflict('INVALID_SPRINT_STATE', 'Only a planned sprint can be deleted.');
    const tasks = await Task.find({
      workspaceId: ctx.workspaceId,
      projectId: s.projectId,
      sprintId,
    })
      .select('_id')
      .session(session)
      .lean();
    await Task.updateMany(
      { workspaceId: ctx.workspaceId, projectId: s.projectId, sprintId },
      { $set: { sprintId: null }, $inc: { version: 1 } },
      { session },
    );
    await Activity.create(
      [
        activity(
          ctx,
          'sprint.deleted',
          { sprint: sprintRef(s) },
          { projectId: s.projectId, sprintId: s._id },
        ),
      ],
      { session },
    );
    return { s, taskIds: tasks.map((t) => String(t._id)) };
  });

  await publish(ctx, [
    {
      type: 'sprint.changed',
      kind: 'deleted',
      projectId: result.s.projectId,
      sprint: toSprintDto(result.s),
    },
    ...(result.taskIds.length
      ? [
          {
            type: 'tasks.sprintChanged' as const,
            projectId: result.s.projectId,
            taskIds: result.taskIds,
            sprintId: null,
          },
        ]
      : []),
  ]);
}

const PRIORITY_RANK = new Map<string, number>(PRIORITIES.map((p, i) => [p, i]));
/** FR-SPR-03: priority (urgent first), then creation order (ObjectIds grow with time). */
const byPriority = (a: TaskCardDto, b: TaskCardDto) =>
  PRIORITY_RANK.get(a.priority)! - PRIORITY_RANK.get(b.priority)! || a.id.localeCompare(b.id);

/** queries.md §10.5: the active + planned sprints with their OPEN tasks, and the backlog. */
export async function backlogView(ctx: Ctx, key: string): Promise<BacklogResponse> {
  const p = await findProject(ctx, key);
  const sprints = await Sprint.find({
    workspaceId: ctx.workspaceId,
    projectId: p._id,
    state: { $in: ['active', 'planned'] },
  })
    .select('-report -scopeSnapshot.taskIds')
    .sort({ state: 1, startDate: 1 }) // 'active' < 'planned' alphabetically
    .lean();
  const tasks = await Task.find({
    workspaceId: ctx.workspaceId,
    projectId: p._id,
    sprintId: { $in: [null, ...sprints.map((s) => s._id)] },
    completedAt: null,
  })
    .select(CARD_FIELDS)
    .lean();
  const cards = tasks.map(toTaskCard).sort(byPriority);
  return {
    sprints: sprints.map((s) => ({
      sprint: toSprintDto(s),
      tasks: cards.filter((t) => t.sprintId === String(s._id)),
    })),
    backlog: cards.filter((t) => t.sprintId === null),
  };
}
