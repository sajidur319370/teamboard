import { useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { COLUMN_CATEGORIES, LIMITS, type ColumnCategory } from '@teamboard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAddColumn } from '@/features/projects/api';
import { useBoardCtx } from './BoardContext';
import { CATEGORY_LABEL } from './ColumnMenu';

/** "+ Add column" after the last column (Admin+). Max 15 columns. */
export function AddColumn() {
  const { board, slug, projectKey } = useBoardCtx();
  const add = useAddColumn(slug, projectKey);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ColumnCategory>('in_progress');
  if (board.project.columns.length >= LIMITS.columnsPerProject) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="h-10 w-48 shrink-0 justify-start border border-dashed">
          <PlusIcon /> Add column
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            add.mutate(
              { name: name.trim(), category },
              {
                onSuccess: () => {
                  setName('');
                  setOpen(false);
                },
              },
            );
          }}
        >
          <Input
            aria-label="Column name"
            placeholder="Column name"
            value={name}
            maxLength={30}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <Select value={category} onValueChange={(v) => setCategory(v as ColumnCategory)}>
            <SelectTrigger className="w-full" aria-label="Column category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLUMN_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="submit"
            size="sm"
            className="w-full"
            disabled={add.isPending || !name.trim()}
          >
            {add.isPending ? 'Adding…' : 'Add column'}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
