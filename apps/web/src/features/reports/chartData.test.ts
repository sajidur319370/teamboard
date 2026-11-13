import { describe, expect, it } from 'vitest';
import type { BurndownPoint } from '@teamboard/shared';
import { lastActual, memberLabel, scopeChangeText, toChartPoints } from './chartData';

const p = (
  day: string,
  scopeTasks: number,
  scopePoints: number,
  remaining: [number, number] | null,
): BurndownPoint => ({
  day,
  scopeTasks,
  scopePoints,
  remainingTasks: remaining?.[0] ?? null,
  remainingPoints: remaining?.[1] ?? null,
  idealTasks: 1,
  idealPoints: 2,
});
const series = [
  p('2026-10-19', 10, 30, [9, 27]),
  p('2026-10-20', 12, 38, [11, 35]), // +2 tasks / +8 pts
  p('2026-10-21', 11, 36, [10, 33]), // −1 / −2
  p('2026-10-22', 11, 36, null), // future
];

describe('toChartPoints', () => {
  it('picks ONE unit for the whole chart (no second axis)', () => {
    expect(toChartPoints(series, 'points').map((x) => [x.remaining, x.scope, x.ideal])).toEqual([
      [27, 30, 2],
      [35, 38, 2],
      [33, 36, 2],
      [null, 36, 2],
    ]);
    expect(toChartPoints(series, 'count').map((x) => x.remaining)).toEqual([9, 11, 10, null]);
  });

  it('marks scope changes day over day (FR-RPT-04)', () => {
    expect(toChartPoints(series, 'points').map((x) => x.scopeChange)).toEqual([0, 8, -2, 0]);
    expect(scopeChangeText(2, 'count')).toBe('+2 tasks added');
    expect(scopeChangeText(-1, 'count')).toBe('−1 task removed');
    expect(scopeChangeText(-2, 'points')).toBe('−2 pts removed');
    expect(scopeChangeText(0, 'points')).toBe('');
  });

  it('the direct label goes on the last day WITH an actual value', () => {
    expect(lastActual(toChartPoints(series, 'points'))?.day).toBe('2026-10-21');
    expect(lastActual([])).toBeUndefined();
  });

  it('former members are labeled in text, not color', () => {
    const m = {
      userId: 'u',
      name: 'Rahim',
      avatarColor: null,
      tasks: 1,
      points: 3,
      isFormer: true,
    };
    expect(memberLabel(m)).toBe('Rahim (former)');
    expect(memberLabel({ ...m, isFormer: false })).toBe('Rahim');
  });
});
