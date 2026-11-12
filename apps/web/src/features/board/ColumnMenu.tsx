import { useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TagIcon,
  Trash2Icon,
} from 'lucide-react';
import { COLUMN_CATEGORIES, type ColumnCategory, type ColumnDto } from '@teamboard/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDeleteColumn, useReorderColumns, useUpdateColumn } from '@/features/projects/api';
import { useBoardCtx } from './BoardContext';

export const CATEGORY_LABEL: Record<ColumnCategory, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

/**
 * Admin+ column actions (FR-BRD-03..06). Moving uses Move left/right (keyboard friendly)
 * and sends the full order. The server enforces the board invariant: its 409 message
 * ("A board needs at least one done…") is shown as a toast.
 */
export function ColumnMenu(props: { column: ColumnDto; taskCount: number; onRename: () => void }) {
  const { column } = props;
  const { board, slug, projectKey } = useBoardCtx();
  const columns = board.project.columns;
  const index = columns.findIndex((c) => c.id === column.id);
  const update = useUpdateColumn(slug, projectKey);
  const reorder = useReorderColumns(slug, projectKey);
  const [deleting, setDeleting] = useState(false);

  const move = (delta: -1 | 1) => {
    const ids = columns.map((c) => c.id);
    const j = index + delta;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    reorder.mutate(ids);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Column actions for ${column.name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={props.onRename}>
            <PencilIcon /> Rename
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <TagIcon /> Category
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={column.category}
                onValueChange={(category) =>
                  update.mutate({ id: column.id, category: category as ColumnCategory })
                }
              >
                {COLUMN_CATEGORIES.map((c) => (
                  <DropdownMenuRadioItem key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={index === 0} onSelect={() => move(-1)}>
            <ArrowLeftIcon /> Move left
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === columns.length - 1} onSelect={() => move(1)}>
            <ArrowRightIcon /> Move right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2Icon /> Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {deleting && (
        <DeleteColumnDialog
          column={column}
          taskCount={props.taskCount}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}

function DeleteColumnDialog(props: { column: ColumnDto; taskCount: number; onClose: () => void }) {
  const { board, slug, projectKey } = useBoardCtx();
  const others = board.project.columns.filter((c) => c.id !== props.column.id);
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const del = useDeleteColumn(slug, projectKey);

  // Always send a target: the board may hide old done tasks (14-day rule), so the visible
  // count can be 0 while the column isn't empty. The server ignores it for empty columns.
  const confirm = () =>
    del.mutate({ id: props.column.id, targetColumnId: target }, { onSuccess: props.onClose });

  return (
    <Dialog open onOpenChange={(o) => !o && !del.isPending && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{props.column.name}”?</DialogTitle>
          <DialogDescription>
            {props.taskCount > 0
              ? `Its ${props.taskCount} task${props.taskCount === 1 ? '' : 's'} move to the bottom of the column you choose.`
              : 'Any tasks in it move to the bottom of the column you choose.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label htmlFor="delete-target" className="text-sm font-medium">
            Move its tasks to
          </label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger id="delete-target" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {others.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} ({CATEGORY_LABEL[c.category]})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={del.isPending || !target}>
            {del.isPending ? 'Deleting…' : 'Delete column'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
