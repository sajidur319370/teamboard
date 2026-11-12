import { useState } from 'react';
import type { ColumnCategory, ColumnDto, TaskCardDto } from '@teamboard/shared';
import { Input } from '@/components/ui/input';
import { useCan } from '@/features/workspace/WorkspaceContext';
import { useUpdateColumn } from '@/features/projects/api';
import { cn } from '@/lib/utils';
import { useBoardCtx } from './BoardContext';
import { CATEGORY_LABEL, ColumnMenu } from './ColumnMenu';
import { QuickAdd } from './QuickAdd';
import { TaskCard } from './TaskCard';

const CATEGORY_DOT: Record<ColumnCategory, string> = {
  todo: 'bg-gray-400',
  in_progress: 'bg-blue-500',
  done: 'bg-green-600',
};

export function BoardColumn(props: {
  column: ColumnDto;
  tasks: TaskCardDto[];
  /** All tasks in this column, before filters (for the delete dialog's count). */
  totalInColumn: number;
}) {
  const { column, tasks } = props;
  const { board, slug, projectKey } = useBoardCtx();
  const can = useCan();
  const archived = !!board.project.archivedAt;
  const canCreate = can('task:create') && !archived;
  const canManage = can('column:manage') && !archived;
  const [renaming, setRenaming] = useState(false);
  const update = useUpdateColumn(slug, projectKey);
  const headingId = `col-${column.id}`;

  const rename = (value: string) => {
    setRenaming(false);
    const name = value.trim();
    if (name && name !== column.name) update.mutate({ id: column.id, name });
  };

  return (
    <section
      aria-labelledby={headingId}
      className="flex max-h-full w-72 shrink-0 flex-col rounded-lg bg-muted/50"
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span
          className={cn('size-2 shrink-0 rounded-full', CATEGORY_DOT[column.category])}
          title={`Category: ${CATEGORY_LABEL[column.category]}`}
        />
        {renaming ? (
          <Input
            aria-label="Column name"
            defaultValue={column.name}
            maxLength={30}
            autoFocus
            className="h-7 text-sm"
            onBlur={(e) => rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <h2 id={headingId} className="truncate text-sm font-semibold">
            {column.name}
          </h2>
        )}
        <span
          className="ml-auto text-xs text-muted-foreground"
          aria-label={`${tasks.length} tasks shown`}
        >
          {tasks.length}
        </span>
        {canManage && (
          <ColumnMenu
            column={column}
            taskCount={props.totalInColumn}
            onRename={() => setRenaming(true)}
          />
        )}
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
