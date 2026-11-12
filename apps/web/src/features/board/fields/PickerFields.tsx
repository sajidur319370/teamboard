import { PlusIcon } from 'lucide-react';
import { LIMITS } from '@teamboard/shared';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LABEL_CHIP, LABEL_DOT } from '@/lib/colors';
import { cn } from '@/lib/utils';
import { useBoardCtx } from '../BoardContext';

const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/**
 * Assignees: members with role ≥ member (BR-10), max 5.
 * Former members already assigned stay listed (checked) and can only be removed (FR-TSK-10).
 */
export function AssigneesField(props: {
  value: string[];
  readOnly: boolean;
  onSave: (ids: string[]) => void;
}) {
  const { people, assignable } = useBoardCtx();
  const current = props.value.map((id) => people.get(id)).filter((p) => !!p);
  const full = props.value.length >= LIMITS.assigneesPerTask;

  const chips = (
    <div className="flex flex-wrap gap-1.5">
      {current.length === 0 && <span className="text-muted-foreground">Nobody</span>}
      {current.map((p) => (
        <span
          key={p.userId}
          className="flex items-center gap-1.5 rounded-full bg-muted py-0.5 pr-2 pl-0.5"
        >
          <UserAvatar name={p.name} color={p.avatarColor} className="size-5 text-[10px]" />
          <span className={cn('text-sm', p.former && 'text-muted-foreground line-through')}>
            {p.name}
          </span>
          {p.former && <span className="text-xs text-muted-foreground">(former)</span>}
        </span>
      ))}
    </div>
  );
  if (props.readOnly) return chips;

  const formerAssigned = current.filter((p) => p.former);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Edit assignees">
            <PlusIcon /> Edit
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1">
          <ul className="max-h-72 overflow-y-auto">
            {[...assignable, ...formerAssigned].map((m) => {
              const checked = props.value.includes(m.userId);
              const former = 'former' in m && m.former;
              const disabled = (!checked && full) || (former && !checked);
              return (
                <li key={m.userId}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted',
                      disabled && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={() => props.onSave(toggle(props.value, m.userId))}
                    />
                    <UserAvatar
                      name={m.name}
                      color={m.avatarColor}
                      className="size-5 text-[10px]"
                    />
                    <span className="truncate">
                      {m.name}
                      {former && ' (former)'}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {full && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              At most {LIMITS.assigneesPerTask} assignees.
            </p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Labels from the project (read from the board), max 10 per task. */
export function LabelsField(props: {
  value: string[];
  readOnly: boolean;
  onSave: (ids: string[]) => void;
}) {
  const { board, labels } = useBoardCtx();
  const current = props.value.map((id) => labels.get(id)).filter((l) => !!l);
  const full = props.value.length >= LIMITS.labelsPerTask;

  const chips = (
    <div className="flex flex-wrap gap-1">
      {current.length === 0 && <span className="text-muted-foreground">None</span>}
      {current.map((l) => (
        <span key={l.id} className={cn('rounded-full px-2 py-0.5 text-xs', LABEL_CHIP[l.color])}>
          {l.name}
        </span>
      ))}
    </div>
  );
  if (props.readOnly) return chips;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Edit labels">
            <PlusIcon /> Edit
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          {board.project.labels.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">
              This project has no labels yet. Admins can add them in project settings.
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {board.project.labels.map((l) => {
                const checked = props.value.includes(l.id);
                const disabled = !checked && full;
                return (
                  <li key={l.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted',
                        disabled && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={() => props.onSave(toggle(props.value, l.id))}
                      />
                      <span className={cn('size-2.5 rounded-full', LABEL_DOT[l.color])} />
                      <span className="truncate">{l.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
