// Date-only ('YYYY-MM-DD') helpers shared by the API (reports) and the web (due badges).

/** 'YYYY-MM-DD' for "now" in a given IANA timezone. 'en-CA' formats as an ISO date. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Whole days from a to b ('YYYY-MM-DD' strings). Positive when b is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export type DueState = 'none' | 'overdue' | 'soon' | 'later';

/**
 * FR-TSK-08 / FR-BRD-08: overdue = due before today (workspace timezone) and not done;
 * soon = due within 2 days. A completed task is never overdue.
 */
export function dueState(
  dueDate: string | null,
  completed: boolean,
  tz: string,
  now = new Date(),
): DueState {
  if (!dueDate || completed) return 'none';
  const days = daysBetween(todayIn(tz, now), dueDate);
  if (days < 0) return 'overdue';
  if (days <= 2) return 'soon';
  return 'later';
}
