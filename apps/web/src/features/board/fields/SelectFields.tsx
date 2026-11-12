import { PRIORITIES, STORY_POINTS, type Priority } from '@teamboard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PRIORITY_ICON } from '../TaskCard';

const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'None',
};

export function PriorityField(props: {
  value: Priority;
  readOnly: boolean;
  onSave: (v: Priority) => void;
}) {
  if (props.readOnly) {
    return (
      <span className="flex items-center gap-1">
        {PRIORITY_ICON[props.value]} {PRIORITY_LABEL[props.value]}
      </span>
    );
  }
  return (
    <Select value={props.value} onValueChange={(v) => props.onSave(v as Priority)}>
      <SelectTrigger className="w-40" aria-label="Priority">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRIORITIES.map((p) => (
          <SelectItem key={p} value={p}>
            <span className="flex items-center gap-1.5">
              {PRIORITY_ICON[p] ?? <span className="size-4" />} {PRIORITY_LABEL[p]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PointsField(props: {
  value: number | null;
  readOnly: boolean;
  onSave: (v: (typeof STORY_POINTS)[number] | null) => void;
}) {
  if (props.readOnly) return <span>{props.value ?? '—'}</span>;
  return (
    <Select
      value={props.value === null ? 'none' : String(props.value)}
      onValueChange={(v) =>
        props.onSave(v === 'none' ? null : (Number(v) as (typeof STORY_POINTS)[number]))
      }
    >
      <SelectTrigger className="w-40" aria-label="Story points">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">None</SelectItem>
        {STORY_POINTS.map((p) => (
          <SelectItem key={p} value={String(p)}>
            {p}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A plain date input in the browser's own picker; "Clear" sends null. */
export function DueDateField(props: {
  value: string | null;
  readOnly: boolean;
  onSave: (v: string | null) => void;
}) {
  if (props.readOnly) return <span>{props.value ?? '—'}</span>;
  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        aria-label="Due date"
        className="w-44"
        min="2000-01-01"
        max="2100-12-31"
        value={props.value ?? ''}
        onChange={(e) => {
          // Only save complete dates; clearing the input sends null.
          const v = e.target.value;
          if (v === '') props.onSave(null);
          else if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== props.value) props.onSave(v);
        }}
      />
      {props.value && (
        <Button variant="ghost" size="sm" onClick={() => props.onSave(null)}>
          Clear
        </Button>
      )}
    </div>
  );
}
