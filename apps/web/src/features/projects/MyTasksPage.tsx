import { Link } from 'react-router';
import { dueState, type TaskCardDto } from '@teamboard/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspace } from '@/features/workspace/WorkspaceContext';
import { PRIORITY_ICON } from '@/features/board/TaskCard';
import { cn } from '@/lib/utils';
import { useMyTasks } from './api';

const DUE_CLASS = {
  none: 'text-muted-foreground',
  later: 'text-muted-foreground',
  soon: 'font-medium text-amber-600',
  overdue: 'font-medium text-red-600',
} as const;

/** FR-TSK-11: my open tasks across the workspace's active projects, by due date. */
export function MyTasksPage() {
  const { workspace } = useWorkspace();
  const q = useMyTasks(workspace.slug);
  const tz = workspace.settings.timezone;

  return (
    <div className="max-w-3xl p-4 sm:p-6">
      <h1 className="mb-6 text-xl font-semibold">My tasks</h1>
      {q.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : q.error ? (
        <p className="text-destructive">{q.error.message}</p>
      ) : q.data.tasks.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Nothing assigned to you 🎉
        </p>
      ) : (
        <div className="space-y-8">
          {q.data.projects.map((p) => {
            const tasks = q.data.tasks.filter((t) => t.projectId === p.id);
            return (
              <section key={p.id} aria-labelledby={`mt-${p.id}`}>
                <h2 id={`mt-${p.id}`} className="mb-2 text-sm font-semibold text-muted-foreground">
                  {p.name} <span className="font-mono">{p.key}</span> · {tasks.length}
                </h2>
                <ul className="divide-y rounded-lg border">
                  {tasks.map((t) => (
                    <TaskRow key={t.id} task={t} projectKey={p.key} slug={workspace.slug} tz={tz} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskRow(props: { task: TaskCardDto; projectKey: string; slug: string; tz: string }) {
  const { task: t } = props;
  const due = dueState(t.dueDate, false, props.tz);
  return (
    <li>
      <Link
        to={`/w/${props.slug}/p/${props.projectKey}/tasks/${t.number}`}
        className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50"
      >
        <span className="w-5 shrink-0">{PRIORITY_ICON[t.priority]}</span>
        <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
          {props.projectKey}-{t.number}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
        {t.dueDate && <span className={cn('shrink-0 text-xs', DUE_CLASS[due])}>{t.dueDate}</span>}
      </Link>
    </li>
  );
}
