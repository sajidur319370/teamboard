import type { BurndownPoint, MemberStatDto, ReportUnit } from '@teamboard/shared';

export interface ChartPoint {
  day: string;
  remaining: number | null;
  ideal: number | null;
  scope: number;
  /** FR-RPT-04: scope change vs the previous day (+ added, − removed), 0 if none. */
  scopeChange: number;
}

/** The API series in ONE unit, plus the day-over-day scope change for the tooltip. */
export function toChartPoints(points: BurndownPoint[], unit: ReportUnit): ChartPoint[] {
  const pts = unit === 'points';
  return points.map((p, i) => {
    const scope = pts ? p.scopePoints : p.scopeTasks;
    const prev = i === 0 ? scope : pts ? points[i - 1]!.scopePoints : points[i - 1]!.scopeTasks;
    return {
      day: p.day,
      remaining: pts ? p.remainingPoints : p.remainingTasks,
      ideal: pts ? p.idealPoints : p.idealTasks,
      scope,
      scopeChange: scope - prev,
    };
  });
}

/** The last day with an actual value (the end-of-line direct label). */
export function lastActual(data: ChartPoint[]): ChartPoint | undefined {
  for (let i = data.length - 1; i >= 0; i--) if (data[i]!.remaining !== null) return data[i];
  return undefined;
}

/** Members bar labels: "(former)" so the tag never relies on color (FR-MEM-06c). */
export const memberLabel = (m: MemberStatDto) => (m.isFormer ? `${m.name} (former)` : m.name);

/** "+2 added", "−1 removed", "" */
export function scopeChangeText(n: number, unit: ReportUnit) {
  if (n === 0) return '';
  const what = unit === 'points' ? 'pts' : n === 1 || n === -1 ? 'task' : 'tasks';
  return n > 0 ? `+${n} ${what} added` : `−${-n} ${what} removed`;
}
