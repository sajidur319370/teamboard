import type { ReactNode } from 'react';
import {
  isRole,
  type ActivityDto,
  type ActivityMetadata,
  type Priority,
  type TaskRef,
  type UserRef,
} from '@teamboard/shared';
import { PRIORITY_LABEL, ROLE_LABEL, shortDate } from '@/lib/format';

/** What the renderer needs from its surroundings (links, current names). */
export interface RenderCtx {
  /** The name to show: the snapshot, else the current member name, else "someone". */
  nameOf: (u: UserRef | string) => string;
  /** A task mention, e.g. a link to the drawer. `gone`: the task was deleted. */
  task: (t: TaskRef, gone?: boolean) => ReactNode;
}

const q = (s: string) => <>“{s}”</>;
const role = (r: string) => (isRole(r) ? ROLE_LABEL[r] : r);
const WORKSPACE_FIELDS: Record<string, string> = {
  timezone: 'timezone',
  weekStartsOn: 'week start',
  workingDays: 'working days',
};
const PROJECT_FIELDS: Record<string, string> = {
  name: 'name',
  description: 'description',
  leadId: 'lead',
};
const list = (fields: string[], names: Record<string, string>) =>
  fields.map((f) => names[f] ?? f).join(', ');

function taskUpdated(m: ActivityMetadata<'task.updated'>, r: RenderCtx): ReactNode {
  const T = r.task(m.task);
  const { from, to } = m;
  switch (m.field) {
    case 'title':
      return (
        <>
          renamed {T} from {q(String(from))}
        </>
      ); // the task snapshot has the new title
    case 'description':
      return <>updated the description of {T}</>; // FR-ACT-08: no text diff
    case 'priority': {
      const p = (v: unknown) => PRIORITY_LABEL[v as Priority] ?? String(v);
      return (
        <>
          changed the priority of {T} from {p(from)} to {p(to)}
        </>
      );
    }
    case 'dueDate':
      return typeof to === 'string' ? (
        <>
          set the due date of {T} to {shortDate(`${to}T12:00:00`)}
        </>
      ) : (
        <>removed the due date of {T}</>
      );
    case 'storyPoints':
      return to === null || to === undefined ? (
        <>cleared the story points of {T}</>
      ) : (
        <>
          set the story points of {T} to {String(to)}
        </>
      );
    case 'labelIds':
      return <>changed the labels on {T}</>;
    default:
      return (
        <>
          changed {m.field} on {T}
        </>
      );
  }
}

/**
 * FR-ACT-05: the sentence after the actor's name, built from structured data. One case per
 * action; `default: never` makes TypeScript list any action that has no sentence yet.
 */
export function describeActivity(a: ActivityDto, r: RenderCtx): ReactNode {
  switch (a.action) {
    case 'workspace.created':
      return <>created the workspace {q(a.metadata.name)}</>;
    case 'workspace.updated': {
      const { name, ...rest } = a.metadata.changes;
      if (name) return <>renamed the workspace to {q(name)}</>;
      return <>changed the workspace {list(Object.keys(rest), WORKSPACE_FIELDS)}</>;
    }
    case 'member.joined':
      return <>joined as {role(a.metadata.role)}</>;
    case 'member.role_changed':
      return (
        <>
          changed {r.nameOf(a.metadata.user)}’s role from {role(a.metadata.from)} to{' '}
          {role(a.metadata.to)}
        </>
      );
    case 'member.removed':
      return <>removed {r.nameOf(a.metadata.user)} from the workspace</>;
    case 'member.left':
      return <>left the workspace</>;
    case 'ownership.transferred':
      return <>transferred ownership to {r.nameOf(a.metadata.to)}</>;
    case 'invite.created':
      return <>created an invite link ({role(a.metadata.role)})</>;
    case 'invite.revoked':
      return <>revoked an invite link ({role(a.metadata.role)})</>;

    case 'project.created':
      return (
        <>
          created project {a.metadata.name} ({a.metadata.key})
        </>
      );
    case 'project.updated':
      return (
        <>
          updated the {list(a.metadata.changes, PROJECT_FIELDS)} of project{' '}
          {a.metadata.name ?? 'a project'}
        </>
      );
    case 'project.archived':
      return <>archived project {a.metadata.name}</>;
    case 'project.unarchived':
      return <>restored project {a.metadata.name} from the archive</>;
    case 'project.deleted':
      return (
        <>
          deleted project {a.metadata.name} ({a.metadata.key})
        </>
      );

    case 'column.created':
      return <>added the column {q(a.metadata.name)}</>;
    case 'column.renamed':
      return (
        <>
          renamed the column {q(a.metadata.from)} to {q(a.metadata.to)}
        </>
      );
    case 'column.deleted': {
      const { name, movedTo, movedTasks } = a.metadata;
      return (
        <>
          deleted the column {q(name)}
          {movedTo && movedTasks > 0 && (
            <>
              {' '}
              and moved {movedTasks} {movedTasks === 1 ? 'task' : 'tasks'} to {q(movedTo)}
            </>
          )}
        </>
      );
    }
    case 'column.reordered':
      return <>reordered the columns</>;

    case 'task.created':
      return (
        <>
          created {r.task(a.metadata.task)} in {a.metadata.column.name}
        </>
      );
    case 'task.updated':
      return taskUpdated(a.metadata, r);
    case 'task.assigned':
      return a.metadata.user.id === a.actor.id ? (
        <>assigned themselves to {r.task(a.metadata.task)}</>
      ) : (
        <>
          assigned {r.task(a.metadata.task)} to {r.nameOf(a.metadata.user)}
        </>
      );
    case 'task.unassigned':
      return a.metadata.user.id === a.actor.id ? (
        <>unassigned themselves from {r.task(a.metadata.task)}</>
      ) : (
        <>
          unassigned {r.nameOf(a.metadata.user)} from {r.task(a.metadata.task)}
        </>
      );
    case 'task.moved':
      return (
        <>
          moved {r.task(a.metadata.task)} from {a.metadata.from.name} to {a.metadata.to.name}
        </>
      );
    case 'task.completed':
      return <>completed {r.task(a.metadata.task)}</>;
    case 'task.reopened':
      return <>reopened {r.task(a.metadata.task)}</>;
    case 'task.added_to_sprint':
      return (
        <>
          added {r.task(a.metadata.task)} to {a.metadata.sprint.name}
        </>
      );
    case 'task.removed_from_sprint':
      return (
        <>
          removed {r.task(a.metadata.task)} from {a.metadata.sprint.name}
        </>
      );
    case 'task.deleted':
      return (
        <>
          deleted {r.task(a.metadata.task, true)} {q(a.metadata.task.title)}
        </>
      );

    case 'comment.created':
      return (
        <>
          commented on {r.task(a.metadata.task)}: {q(a.metadata.excerpt)}
        </>
      );
    case 'comment.deleted':
      return a.metadata.task ? (
        <>deleted a comment on {r.task(a.metadata.task)}</>
      ) : (
        <>deleted a comment</>
      );

    case 'sprint.created':
      return <>created {a.metadata.sprint.name}</>;
    case 'sprint.started':
      return <>started {a.metadata.sprint.name}</>;
    case 'sprint.completed':
      return <>completed {a.metadata.sprint.name}</>;
    case 'sprint.deleted':
      return <>deleted {a.metadata.sprint.name}</>;

    default: {
      const missing: never = a; // ← a compile error here names every unrendered action
      return <>did something ({String((missing as ActivityDto).action)})</>;
    }
  }
}

/**
 * The catalog shows task.completed / task.reopened "merged with task.moved": a move into or
 * out of Done writes both (same actor, task and instant), so hide the second line.
 */
export function mergeMoves(items: ActivityDto[]): ActivityDto[] {
  const moves = new Set(
    items
      .filter((a) => a.action === 'task.moved')
      .map((a) => `${a.taskId}|${a.actor.id}|${a.createdAt}`),
  );
  return items.filter(
    (a) =>
      !(
        (a.action === 'task.completed' || a.action === 'task.reopened') &&
        moves.has(`${a.taskId}|${a.actor.id}|${a.createdAt}`)
      ),
  );
}
