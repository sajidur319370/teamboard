import { useNavigate, useLocation } from 'react-router';
import { daysBetween, todayIn, type BoardResponse } from '@teamboard/shared';
import { AlertTriangleIcon } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { plural } from '@/lib/format';
import { useSprints } from './api';

/**
 * Board view: Active sprint (when one runs) · Backlog · All open tasks · any sprint.
 * Writes ?sprint= and keeps the other params (filters).
 */
export function SprintSelector(props: { slug: string; projectKey: string; board: BoardResponse }) {
  const { slug, projectKey, board } = props;
  const sprints = useSprints(slug, projectKey);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const others = (sprints.data ?? []).filter((s) => s.state !== 'active');

  const choose = (value: string) => {
    const params = new URLSearchParams(search);
    params.set('sprint', value);
    void navigate(`${pathname}?${params.toString()}`, { replace: true });
  };

  return (
    <Select value={board.view} onValueChange={choose}>
      <SelectTrigger size="sm" className="w-auto min-w-40" aria-label="Board view">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {board.activeSprint && (
          <SelectItem value="active">Active: {board.activeSprint.name}</SelectItem>
        )}
        <SelectItem value="all">All open tasks</SelectItem>
        <SelectItem value="backlog">Backlog</SelectItem>
        {others.length > 0 && (
          <SelectGroup>
            <SelectLabel>Sprints</SelectLabel>
            {others.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} ({s.state})
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

/** Sprint name, goal, days left; FR-SPR-09 amber banner once it is past its end date. */
export function ActiveSprintInfo({ board, tz }: { board: BoardResponse; tz: string }) {
  const s = board.activeSprint;
  if (!s || board.view !== 'active') return null;
  const left = daysBetween(todayIn(tz, new Date()), s.endDate);
  if (left < 0) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-md bg-amber-100 px-3 py-1.5 text-sm text-amber-900"
      >
        <AlertTriangleIcon className="size-4 shrink-0" />
        {s.name} ended {plural(-left, 'day')} ago. Complete it to see the final report.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {s.goal && <span className="text-foreground">{s.goal} · </span>}
      {left === 0 ? 'Last day' : `${plural(left, 'day')} left`}
    </p>
  );
}
