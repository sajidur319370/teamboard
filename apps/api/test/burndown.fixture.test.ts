import { describe, expect, it } from 'vitest';
import { burndownSeries, type CumRow } from '../src/modules/reports/burndown';

// TR-08 / AC-RPT-01: the worked example of queries.md §12.3, as a pure-function test.
// 10-day sprint Mon 2026-10-19 → Wed 2026-10-28 (over a weekend), snapshot 10 tasks /
// 30 points, none done. Mon–Fri working days.
const sprint = {
  _id: 'x',
  state: 'active',
  startDate: '2026-10-19',
  endDate: '2026-10-28',
  startedAt: new Date('2026-10-19T03:00:00Z'),
  scopeSnapshot: { totalTasks: 10, totalPoints: 30, doneTasks: 0, donePoints: 0 },
};

// Cumulative rows exactly as the pipeline returns them: only days WITH events.
const rows: CumRow[] = [
  // D1: complete a 3-pt task
  { day: '2026-10-19', cumScopeTasks: 0, cumScopePoints: 0, cumDoneTasks: 1, cumDonePoints: 3 },
  // D3: add 2 tasks (5 + 3)
  { day: '2026-10-21', cumScopeTasks: 2, cumScopePoints: 8, cumDoneTasks: 1, cumDonePoints: 3 },
  // D4: remove a 2-pt task (not done)
  { day: '2026-10-22', cumScopeTasks: 1, cumScopePoints: 6, cumDoneTasks: 1, cumDonePoints: 3 },
  // D6 (Saturday): reopen the D1 task
  { day: '2026-10-24', cumScopeTasks: 1, cumScopePoints: 6, cumDoneTasks: 0, cumDonePoints: 0 },
];

/** The hand-calculated table (queries.md §12.3), end of each day. */
const EXPECTED = {
  //  day          scope t/p  remaining t/p
  '2026-10-19': [10, 30, 9, 27],
  '2026-10-20': [10, 30, 9, 27], // no events: carried forward
  '2026-10-21': [12, 38, 11, 35],
  '2026-10-22': [11, 36, 10, 33],
  '2026-10-23': [11, 36, 10, 33],
  '2026-10-24': [11, 36, 11, 36], // reopen: remaining goes UP
} as const;

describe('burndown fixture (AC-RPT-01, queries.md §12.3)', () => {
  const series = burndownSeries(sprint, rows, [1, 2, 3, 4, 5], '2026-10-24');
  const at = (day: string) => series.find((p) => p.day === day)!;

  it('covers every calendar day, start to end inclusive', () => {
    expect(series.map((p) => p.day)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
    ]);
  });

  it.each(Object.entries(EXPECTED))('%s matches the hand-calculated table', (day, v) => {
    const p = at(day);
    expect([p.scopeTasks, p.scopePoints, p.remainingTasks, p.remainingPoints]).toEqual(v);
  });

  it('future days have no actual line, but keep scope and the ideal', () => {
    expect(at('2026-10-25')).toMatchObject({
      remainingPoints: null,
      remainingTasks: null,
      scopePoints: 36,
    });
    expect(at('2026-10-28').idealPoints).toBe(0);
  });

  it('ideal: 8 working days, flat over the weekend, 0 on the last day', () => {
    const ideal = series.map((p) => p.idealPoints);
    expect(ideal).toEqual([26.3, 22.5, 18.8, 15, 11.3, 11.3, 11.3, 7.5, 3.8, 0]); // 30 × (1 − k/8)
    expect(series.map((p) => p.idealTasks)).toEqual([8.8, 7.5, 6.3, 5, 3.8, 3.8, 3.8, 2.5, 1.3, 0]);
  });

  it('work done BEFORE the start is not remaining (D4)', () => {
    const s = {
      ...sprint,
      scopeSnapshot: { totalTasks: 10, totalPoints: 30, doneTasks: 2, donePoints: 6 },
    };
    const first = burndownSeries(s, [], [1, 2, 3, 4, 5], '2026-10-19')[0]!;
    expect(first).toMatchObject({ remainingTasks: 8, remainingPoints: 24 });
    expect(first.idealPoints).toBe(21); // 24 × 7/8
  });

  it('an overdue active sprint extends to today; the ideal stops at the end date (FR-SPR-09)', () => {
    const late = burndownSeries(sprint, rows, [1, 2, 3, 4, 5], '2026-10-30');
    expect(late.at(-1)).toMatchObject({
      day: '2026-10-30',
      remainingPoints: 36,
      idealPoints: null,
    });
    // ...but a COMPLETED sprint never extends
    const done = burndownSeries(
      { ...sprint, state: 'completed' },
      rows,
      [1, 2, 3, 4, 5],
      '2026-10-30',
    );
    expect(done.at(-1)!.day).toBe('2026-10-28');
  });

  it('other working weeks: Sun–Thu (e.g. Bangladesh) makes Fri+Sat flat', () => {
    const s = burndownSeries(sprint, [], [0, 1, 2, 3, 4], '2026-10-28');
    const ideal = Object.fromEntries(s.map((p) => [p.day, p.idealPoints]));
    expect(ideal['2026-10-23']).toBe(ideal['2026-10-22']); // Friday flat
    expect(ideal['2026-10-24']).toBe(ideal['2026-10-22']); // Saturday flat
    expect(ideal['2026-10-25']).toBeLessThan(ideal['2026-10-24']!); // Sunday works
  });
});
