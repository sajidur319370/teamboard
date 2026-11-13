import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MemberStatDto, ReportUnit } from '@teamboard/shared';
import { Button } from '@/components/ui/button';
import { memberLabel } from './chartData';

const TEXT = 'var(--chart-text)';
type Row = MemberStatDto & { label: string; value: number };

/**
 * FR-RPT-05: completed work per assignee. One series → one color, no legend (the title
 * names it); the value sits at the bar's tip. A task with two assignees counts for both.
 */
export function MembersChart({ members, unit }: { members: MemberStatDto[]; unit: ReportUnit }) {
  const [table, setTable] = useState(false);
  const rows: Row[] = members.map((m) => ({
    ...m,
    label: memberLabel(m),
    value: unit === 'points' ? m.points : m.tasks,
  }));
  const what = unit === 'points' ? 'points' : 'tasks';

  return (
    <figure className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <figcaption className="text-sm text-muted-foreground">
          Completed {what} per member. A task with several assignees counts for each of them.
        </figcaption>
        <Button variant="ghost" size="xs" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? 'Show chart' : 'Show table'}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing completed yet.</p>
      ) : table ? (
        <table className="w-full rounded-md border text-sm">
          <caption className="sr-only">Completed per member</caption>
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Member</th>
              <th className="px-3 py-2 text-right font-medium">Tasks</th>
              <th className="px-3 py-2 text-right font-medium">Points</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.userId ?? 'unassigned'} className="border-t">
                <td className="px-3 py-1.5">{r.label}</td>
                <td className="px-3 py-1.5 text-right">{r.tasks}</td>
                <td className="px-3 py-1.5 text-right">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div
          style={{ height: rows.length * 40 + 32 }}
          role="img"
          aria-label={`Completed ${what} per member. Use "Show table" for the numbers.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 4, right: 40, bottom: 4, left: 4 }}
            >
              <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fill: TEXT, fontSize: 12 }}
                stroke={TEXT}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={140}
                tick={{ fill: TEXT, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                content={({ active, payload }) => {
                  const r = payload?.[0]?.payload as Row | undefined;
                  if (!active || !r) return null;
                  return (
                    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                      <p className="font-medium">{r.label}</p>
                      <p className="tabular-nums text-muted-foreground">
                        {r.tasks} tasks · {r.points} points
                      </p>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="value"
                fill="var(--chart-actual)"
                barSize={20}
                radius={[0, 4, 4, 0]} // rounded data end, square at the baseline
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="value"
                  position="right"
                  fill="var(--foreground)"
                  fontSize={12}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
