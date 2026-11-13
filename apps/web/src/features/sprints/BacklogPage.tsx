import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeftIcon, BarChart3Icon, PlusIcon } from 'lucide-react';
import { ROLE_LEVEL, todayIn, type SprintDto, type TaskCardDto } from '@teamboard/shared';
import { ApiError } from '@/api/client';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PRIORITY_ICON } from '@/features/board/TaskCard';
import { useProject } from '@/features/projects/api';
import { useCan, useWorkspace } from '@/features/workspace/WorkspaceContext';
import { dayRange, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBoardSocket } from '@/socket/useBoardSocket';
import { STATE_LABEL, useBacklog, useDeleteSprint, useSprintTasks, useStartSprint } from './api';
import { CompleteSprintDialog } from './CompleteSprintDialog';
import { SprintFormDialog } from './SprintFormDialog';

const points = (ts: TaskCardDto[]) => ts.reduce((n, t) => n + (t.storyPoints ?? 0), 0);

/** FR-SPR-03/04 (journey J4): plan sprints, move work in and out, start and complete. */
export function BacklogPage() {
  const { slug = '', key = '' } = useParams();
  const { workspace, role } = useWorkspace();
  const can = useCan();
  const project = useProject(slug, key);
  const backlog = useBacklog(slug, key);
  useBoardSocket(slug, key, project.data?.id); // live: sprint:* / tasks:sprintChanged
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sprints = useMemo(() => backlog.data?.sprints ?? [], [backlog.data]);
  const planned = sprints.filter((s) => s.sprint.state === 'planned').map((s) => s.sprint);
  const archived = !!project.data?.archivedAt;
  const isAdmin = ROLE_LEVEL[role] >= ROLE_LEVEL.admin;
  // FR-SPR-04: Member+ plans; only Admin+ changes the running sprint's scope.
  const mayPlan = (s: SprintDto | null) =>
    !archived && can('sprint:assignTasks') && (!s || s.state === 'planned' || isAdmin);
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (backlog.isPending || project.isPending) {
    return (
      <div className="space-y-3 p-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (backlog.error || project.error) {
    const err = backlog.error ?? project.error;
    return (
      <p className="p-6 text-muted-foreground">
        {err instanceof ApiError && err.status === 404
          ? "This project doesn't exist, or it was deleted."
          : err?.message}
      </p>
    );
  }

  const nextNumber = sprints.length + 1; // a hint only; the server numbers sprints
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to={`/w/${slug}/p/${key}/board`}>
            <ArrowLeftIcon /> Board
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{project.data.name}: backlog</h1>
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/w/${slug}/p/${key}/reports`}>
              <BarChart3Icon /> Reports
            </Link>
          </Button>
          {can('sprint:manage') && !archived && (
            <SprintFormDialog
              slug={slug}
              projectKey={key}
              nextNumber={nextNumber}
              trigger={
                <Button size="sm">
                  <PlusIcon /> New sprint
                </Button>
              }
            />
          )}
        </div>
      </div>

      {sprints.map(({ sprint, tasks }) => (
        <Section
          key={sprint.id}
          title={
            <>
              {sprint.name}
              <StateBadge sprint={sprint} tz={workspace.settings.timezone} />
            </>
          }
          meta={`${dayRange(sprint.startDate, sprint.endDate)} · ${plural(tasks.length, 'open task')} · ${points(tasks)} pts`}
          goal={sprint.goal}
          actions={
            <SprintActions
              slug={slug}
              projectKey={key}
              sprint={sprint}
              taskCount={tasks.length}
              planned={planned.filter((p) => p.id !== sprint.id)}
              canManage={can('sprint:manage') && !archived}
            />
          }
          tasks={tasks}
          selectable={mayPlan(sprint)}
          selected={selected}
          onToggle={toggle}
          bulk={
            <BulkActions
              slug={slug}
              projectKey={key}
              ids={tasks.filter((t) => selected.has(t.id)).map((t) => t.id)}
              from={sprint}
              targets={[]}
              onDone={() => setSelected(new Set())}
            />
          }
          empty="No open tasks. Select tasks in the backlog below and move them here."
          taskHref={(t) => `/w/${slug}/p/${key}/tasks/${t.number}`}
        />
      ))}

      <Section
        title="Backlog"
        meta={`${plural(backlog.data.backlog.length, 'task')} · ${points(backlog.data.backlog)} pts`}
        tasks={backlog.data.backlog}
        selectable={mayPlan(null)}
        selected={selected}
        onToggle={toggle}
        bulk={
          <BulkActions
            slug={slug}
            projectKey={key}
            ids={backlog.data.backlog.filter((t) => selected.has(t.id)).map((t) => t.id)}
            from={null}
            targets={sprints.map((s) => s.sprint).filter((s) => mayPlan(s))}
            onDone={() => setSelected(new Set())}
          />
        }
        empty="The backlog is empty."
        taskHref={(t) => `/w/${slug}/p/${key}/tasks/${t.number}`}
      />
      {sprints.length === 0 && can('sprint:manage') && (
        <p className="text-sm text-muted-foreground">
          No sprints yet. Sprints are optional: the board works as plain Kanban without them.
        </p>
      )}
    </div>
  );
}

function StateBadge({ sprint, tz }: { sprint: SprintDto; tz: string }) {
  const overdue = sprint.state === 'active' && sprint.endDate < todayIn(tz, new Date());
  return (
    <span
      className={cn(
        'ml-2 rounded px-1.5 py-0.5 align-middle text-xs font-medium',
        sprint.state === 'active'
          ? overdue
            ? 'bg-amber-100 text-amber-900'
            : 'bg-green-100 text-green-900'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {overdue ? 'Overdue' : STATE_LABEL[sprint.state]}
    </span>
  );
}

function Section(props: {
  title: React.ReactNode;
  meta: string;
  goal?: string;
  actions?: React.ReactNode;
  tasks: TaskCardDto[];
  selectable: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  bulk: React.ReactNode;
  empty: string;
  taskHref: (t: TaskCardDto) => string;
}) {
  return (
    <section className="rounded-lg border">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{props.title}</h2>
          <p className="text-xs text-muted-foreground">{props.meta}</p>
          {props.goal && <p className="mt-1 text-sm">{props.goal}</p>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {props.selectable && props.bulk}
          {props.actions}
        </div>
      </header>
      {props.tasks.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{props.empty}</p>
      ) : (
        <ul className="divide-y">
          {props.tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              {props.selectable && (
                <Checkbox
                  checked={props.selected.has(t.id)}
                  onCheckedChange={() => props.onToggle(t.id)}
                  aria-label={`Select ${t.title}`}
                />
              )}
              <Link
                to={props.taskHref(t)}
                className="min-w-0 flex-1 truncate hover:underline"
                title={t.title}
              >
                {t.title}
              </Link>
              <span className="flex w-5 justify-center">{PRIORITY_ICON[t.priority]}</span>
              <span className="w-8 text-right text-xs text-muted-foreground tabular-nums">
                {t.storyPoints ?? '–'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Backlog → "Move selected to ▾ Sprint"; sprint → "Remove from sprint". */
function BulkActions(props: {
  slug: string;
  projectKey: string;
  ids: string[];
  from: SprintDto | null;
  targets: SprintDto[];
  onDone: () => void;
}) {
  const move = useSprintTasks(props.slug, props.projectKey);
  if (props.ids.length === 0) return null;
  const run = (sprintId: string, action: 'add' | 'remove') =>
    move.mutate(
      { sprintId, action, taskIds: props.ids },
      {
        onSuccess: ({ taskIds }) => {
          const skipped = props.ids.length - taskIds.length;
          toast.success(
            `${plural(taskIds.length, 'task')} ${action === 'add' ? 'added' : 'moved to the backlog'}` +
              (skipped ? ` (${skipped} skipped: done or already there)` : ''),
          );
          props.onDone();
        },
        onError: (e) => toast.error(e.message),
      },
    );

  if (props.from) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={move.isPending}
        onClick={() => run(props.from!.id, 'remove')}
      >
        Remove {props.ids.length} from sprint
      </Button>
    );
  }
  if (props.targets.length === 0) return null;
  return (
    <Select onValueChange={(id) => run(id, 'add')} disabled={move.isPending}>
      <SelectTrigger size="sm" className="w-auto" aria-label="Move selected tasks to a sprint">
        <SelectValue placeholder={`Move ${props.ids.length} to…`} />
      </SelectTrigger>
      <SelectContent>
        {props.targets.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SprintActions(props: {
  slug: string;
  projectKey: string;
  sprint: SprintDto;
  taskCount: number;
  planned: SprintDto[];
  canManage: boolean;
}) {
  const { slug, projectKey, sprint } = props;
  const start = useStartSprint(slug, projectKey);
  const del = useDeleteSprint(slug, projectKey);
  if (!props.canManage) return null;

  const doStart = () =>
    start.mutate(sprint.id, {
      onSuccess: () => toast.success(`${sprint.name} started`),
      onError: (e) =>
        toast.error(
          e instanceof ApiError && e.code === 'ACTIVE_SPRINT_EXISTS'
            ? 'Another sprint is running. Complete it first.' // E18
            : e.message,
        ),
    });

  return (
    <>
      {sprint.state === 'planned' &&
        (props.taskCount === 0 ? (
          <ConfirmDialog
            trigger={<Button size="sm">Start</Button>}
            title={`Start ${sprint.name} with no tasks?`}
            description="You can add tasks later, but the burndown starts from zero." // FR-SPR-05
            confirmLabel="Start anyway"
            onConfirm={() => start.mutateAsync(sprint.id)}
          />
        ) : (
          <Button size="sm" onClick={doStart} disabled={start.isPending}>
            Start
          </Button>
        ))}
      {sprint.state === 'active' && (
        <CompleteSprintDialog
          slug={slug}
          projectKey={projectKey}
          sprint={sprint}
          planned={props.planned}
        />
      )}
      <SprintFormDialog
        slug={slug}
        projectKey={projectKey}
        sprint={sprint}
        trigger={
          <Button size="sm" variant="outline">
            Edit
          </Button>
        }
      />
      {sprint.state === 'planned' && (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="ghost" className="text-destructive">
              Delete
            </Button>
          }
          title={`Delete ${sprint.name}?`}
          description="Its tasks go back to the backlog."
          confirmLabel="Delete"
          destructive
          onConfirm={() =>
            del.mutateAsync(sprint.id).catch((e: Error) => {
              toast.error(e.message);
              throw e;
            })
          }
        />
      )}
    </>
  );
}
