import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { TaskCardDto } from '@teamboard/shared';

export interface BoardFilters {
  assignee: string | null;
  priority: string[];
  label: string | null;
  mine: boolean;
}

export const FILTER_KEYS = ['assignee', 'priority', 'label', 'mine'] as const;

/** Read filters from a query string. Pure, so it's easy to test. */
export function parseFilters(params: URLSearchParams): BoardFilters {
  return {
    assignee: params.get('assignee'),
    priority: params.getAll('priority'),
    label: params.get('label'),
    mine: params.get('mine') === '1',
  };
}

export const hasFilters = (f: BoardFilters) =>
  !!(f.assignee || f.priority.length || f.label || f.mine);

/**
 * Board filters live in the URL: they survive reloads, can be shared, and work with Back.
 * Changing a filter keeps every other param (e.g. `sprint`) and replaces the history entry,
 * so filter clicks don't fill the Back stack.
 */
export function useBoardFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);

  const set = (key: (typeof FILTER_KEYS)[number], value: string | string[] | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(key);
        for (const v of Array.isArray(value) ? value : value ? [value] : []) next.append(key, v);
        return next;
      },
      { replace: true },
    );

  const clear = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of FILTER_KEYS) next.delete(k); // keep the sprint selector
        return next;
      },
      { replace: true },
    );

  return { filters, set, clear, active: hasFilters(filters) };
}

/** The predicate the board groups with. */
export function matches(f: BoardFilters, myId: string) {
  return (t: Pick<TaskCardDto, 'assigneeIds' | 'priority' | 'labelIds'>) =>
    (!f.mine || t.assigneeIds.includes(myId)) &&
    (!f.assignee || t.assigneeIds.includes(f.assignee)) &&
    (f.priority.length === 0 || f.priority.includes(t.priority)) &&
    (!f.label || t.labelIds.includes(f.label));
}
