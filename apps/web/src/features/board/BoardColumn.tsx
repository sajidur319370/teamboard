import type { ColumnCategory, ColumnDto, TaskCardDto } from '@teamboard/shared';
import { useCan } from '@/features/workspace/WorkspaceContext';
import { cn } from '@/lib/utils';
import { useBoardCtx } from './BoardContext';
import { QuickAdd } from './QuickAdd';
import { TaskCard } from './TaskCard';

const CATEGORY_DOT: Record<ColumnCategory, string> = {
  todo: 'bg-gray-400',
  in_progress: 'bg-blue-500',
  done: 'bg-green-600',
};
const CATEGORY_LABEL: Record<ColumnCategory, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

export function BoardColumn({ column, tasks }: { column: ColumnDto; tasks: TaskCardDto[] }) {
  const { board } = useBoardCtx();
  const canCreate = useCan()('task:create') && !board.project.archivedAt;
  const headingId = `col-${column.id}`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex max-h-full w-72 shrink-0 flex-col rounded-lg bg-muted/50"
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span
          className={cn('size-2 rounded-full', CATEGORY_DOT[column.category])}
          title={`Category: ${CATEGORY_LABEL[column.category]}`}
        />
        <h2 id={headingId} className="truncate text-sm font-semibold">
          {column.name}
        </h2>
        <span
          className="ml-auto text-xs text-muted-foreground"
          aria-label={`${tasks.length} tasks`}
        >
          {tasks.length}
        </span>
      </header>

      <ol className="min-h-8 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {tasks.map((t) => (
          <li key={t.id}>
            <TaskCard task={t} />
          </li>
        ))}
        {tasks.length === 0 && !canCreate && (
          <li className="px-1 py-2 text-xs text-muted-foreground">No tasks</li>
        )}
      </ol>

      {canCreate && (
        <div className="px-2 pb-2">
          <QuickAdd columnId={column.id} columnName={column.name} />
        </div>
      )}
    </section>
  );
}
