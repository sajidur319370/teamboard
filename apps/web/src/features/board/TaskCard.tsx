import type { ReactNode } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpIcon,
  MessageSquareIcon,
  MinusIcon,
} from 'lucide-react';
import { dueState, type Priority, type TaskCardDto } from '@teamboard/shared';
import { UserAvatar } from '@/components/UserAvatar';
import { LABEL_CHIP } from '@/lib/colors';
import { cn } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { useBoardCtx } from './BoardContext';

export const PRIORITY_ICON: Record<Priority, ReactNode> = {
  urgent: <ChevronsUpIcon className="size-4 text-red-600" aria-label="Urgent priority" />,
  high: <ArrowUpIcon className="size-4 text-orange-500" aria-label="High priority" />,
  medium: <MinusIcon className="size-4 text-yellow-500" aria-label="Medium priority" />,
  low: <ArrowDownIcon className="size-4 text-blue-500" aria-label="Low priority" />,
  none: null,
};

const DUE_CLASS = {
  none: 'text-muted-foreground',
  later: 'text-muted-foreground',
  soon: 'font-medium text-amber-600',
  overdue: 'font-medium text-red-600',
} as const;

/**
 * FR-BRD-08: number, title (2 lines), avatars (3 + "+N"), priority, due date, labels, comments,
 * points. A plain div: SortableCard around it handles focus, click, keyboard and drag
 * (one tab stop per card). `lifted` = the floating copy under the cursor while dragging.
 */
export function TaskCard({ task, lifted = false }: { task: TaskCardDto; lifted?: boolean }) {
  const { projectKey, people, labels, tz } = useBoardCtx();
  const due = dueState(task.dueDate, !!task.completedAt, tz);
  const assignees = task.assigneeIds.map((id) => people.get(id)).filter((p) => !!p);
  const chips = task.labelIds.map((id) => labels.get(id)).filter((l) => !!l);
  const compact = useUi((s) => s.compactCards); // compact: title + number only

  return (
    <div
      className={cn(
        'cursor-pointer rounded-md border bg-card p-3 text-left shadow-xs transition select-none hover:border-foreground/30',
        lifted && 'rotate-2 cursor-grabbing shadow-lg',
      )}
    >
      <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
        {PRIORITY_ICON[task.priority]}
        <span>
          {projectKey}-{task.number}
        </span>
        {task.storyPoints !== null && (
          <span className="ml-auto rounded bg-muted px-1.5 font-medium" title="Story points">
            {task.storyPoints}
          </span>
        )}
      </div>
      <p className="line-clamp-2 text-sm font-medium">{task.title}</p>

      {!compact && chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.map((l) => (
            <span
              key={l.id}
              className={cn('rounded-full px-2 py-0.5 text-xs', LABEL_CHIP[l.color])}
            >
              {l.name}
            </span>
          ))}
        </div>
      )}

      {!compact && (task.dueDate || task.commentCount > 0 || assignees.length > 0) && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          {task.dueDate && (
            <span className={DUE_CLASS[due]} title={due === 'overdue' ? 'Overdue' : 'Due date'}>
              {task.dueDate}
            </span>
          )}
          {task.commentCount > 0 && (
            <span className="flex items-center gap-0.5 text-muted-foreground" title="Comments">
              <MessageSquareIcon className="size-3" />
              {task.commentCount}
            </span>
          )}
          <span className="ml-auto flex -space-x-1.5">
            {assignees.slice(0, 3).map((a) => (
              <UserAvatar
                key={a.userId}
                name={a.former ? `${a.name} (former member)` : a.name}
                color={a.avatarColor}
                className={cn('size-6 ring-2 ring-card', a.former && 'opacity-50')}
              />
            ))}
            {assignees.length > 3 && (
              <span className="pl-2 text-muted-foreground">+{assignees.length - 3}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
