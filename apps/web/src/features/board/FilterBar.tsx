import { ChevronDownIcon, LayoutListIcon, UserIcon, XIcon } from 'lucide-react';
import { PRIORITIES } from '@teamboard/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LABEL_DOT } from '@/lib/colors';
import { PRIORITY_LABEL } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { useBoardCtx } from './BoardContext';
import { PRIORITY_ICON } from './TaskCard';
import { useBoardFilters } from './useBoardFilters';

const ANY = '__any'; // Radix Select items can't use '' as a value

/** Filters live in the URL (FR-UI): they survive reloads and can be shared. */
export function FilterBar({ shown, total }: { shown: number; total: number }) {
  const { board, people, assignable } = useBoardCtx();
  const { filters, set, clear, active } = useBoardFilters();
  const compact = useUi((s) => s.compactCards);
  const toggleCompact = useUi((s) => s.toggleCompact);
  const formerAssignees = board.formerMembers.map((f) => people.get(f.userId)!).filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Board filters">
      <Button
        variant={filters.mine ? 'default' : 'outline'}
        size="sm"
        aria-pressed={filters.mine}
        onClick={() => set('mine', filters.mine ? null : '1')}
      >
        <UserIcon /> Only my tasks
      </Button>

      <Select
        value={filters.assignee ?? ANY}
        onValueChange={(v) => set('assignee', v === ANY ? null : v)}
      >
        <SelectTrigger size="sm" className="w-40" aria-label="Filter by assignee">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any assignee</SelectItem>
          {[...assignable, ...formerAssignees].map((m) => (
            <SelectItem key={m.userId} value={m.userId}>
              {m.name}
              {'former' in m && m.former ? ' (former)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Filter by priority">
            Priority{filters.priority.length > 0 && ` (${filters.priority.length})`}
            <ChevronDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-1">
          {PRIORITIES.map((p) => {
            const checked = filters.priority.includes(p);
            return (
              <label
                key={p}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() =>
                    set(
                      'priority',
                      checked ? filters.priority.filter((x) => x !== p) : [...filters.priority, p],
                    )
                  }
                />
                {PRIORITY_ICON[p] ?? <span className="size-4" />} {PRIORITY_LABEL[p]}
              </label>
            );
          })}
        </PopoverContent>
      </Popover>

      {board.project.labels.length > 0 && (
        <Select
          value={filters.label ?? ANY}
          onValueChange={(v) => set('label', v === ANY ? null : v)}
        >
          <SelectTrigger size="sm" className="w-36" aria-label="Filter by label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any label</SelectItem>
            {board.project.labels.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                <span className={cn('size-2 rounded-full', LABEL_DOT[l.color])} /> {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {active && (
        <>
          <Button variant="ghost" size="sm" onClick={clear}>
            <XIcon /> Clear
          </Button>
          {/* So nobody thinks tasks vanished */}
          <span className="text-sm text-muted-foreground" aria-live="polite">
            Showing {shown} of {total} tasks
          </span>
        </>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        aria-pressed={compact}
        onClick={toggleCompact}
        title="Compact cards hide labels, due dates and avatars"
      >
        <LayoutListIcon /> {compact ? 'Compact' : 'Detailed'}
      </Button>
    </div>
  );
}
