import { useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReportUnit } from '@teamboard/shared';
import { Button } from '@/components/ui/button';
import { dayLabel } from '@/lib/format';
import { lastActual, scopeChangeText, type ChartPoint } from './chartData';

const TEXT = 'var(--chart-text)';

/**
 * FR-RPT-01: remaining work per day (end of day) vs the ideal line, with scope as a step
 * line. One y-axis: the unit toggle switches the whole chart, never a second axis.
 */
export function BurndownChart({ data, unit }: { data: ChartPoint[]; unit: ReportUnit }) {
  const [table, setTable] = useState(false);
  const label = unit === 'points' ? 'points' : 'tasks';
  const last = lastActual(data);

  return (
    <figure className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <figcaption className="text-sm text-muted-foreground">
          Remaining {label} at the end of each day
        </figcaption>
        <Button variant="ghost" size="xs" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? 'Show chart' : 'Show table'}
        </Button>
      </div>

      {table ? (
        <BurndownTable data={data} unit={unit} />
      ) : (
        <div
          className="h-80"
          role="img"
          aria-label={`Burndown chart in ${label}. Use "Show table" for the numbers.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 48, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="var(--chart-grid)" strokeWidth={1} vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={dayLabel}
                stroke={TEXT}
                tick={{ fill: TEXT, fontSize: 12 }}
                tickLine={false}
                minTickGap={16}
              />
              <YAxis
                allowDecimals={false}
                stroke={TEXT}
                tick={{ fill: TEXT, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                content={({ active, payload }) => (
                  <BurndownTooltip
                    active={!!active}
                    point={payload?.[0]?.payload as ChartPoint | undefined}
                    unit={unit}
                  />
                )}
                cursor={{ stroke: 'var(--chart-ideal)', strokeWidth: 1 }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, color: TEXT }}
                formatter={(v: string) => <span style={{ color: TEXT }}>{v}</span>}
              />
              <Line
                name="Scope"
                dataKey="scope"
                type="stepAfter"
                stroke="var(--chart-scope)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                name="Ideal"
                dataKey="ideal"
                stroke="var(--chart-ideal)"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                name="Remaining"
                dataKey="remaining"
                stroke="var(--chart-actual)"
                strokeWidth={2}
                // Filled markers with a 2px surface ring. Without the fill, recharts paints them
                // white and they punch holes in the line.
                dot={{
                  r: 4,
                  fill: 'var(--chart-actual)',
                  strokeWidth: 2,
                  stroke: 'var(--background)',
                }}
                activeDot={{
                  r: 6,
                  fill: 'var(--chart-actual)',
                  strokeWidth: 2,
                  stroke: 'var(--background)',
                }}
                connectNulls={false}
                isAnimationActive={false}
              />
              {/* One direct label: today's remaining, at the end of the actual line. */}
              {last && last.remaining !== null && (
                <ReferenceDot
                  x={last.day}
                  y={last.remaining}
                  r={0}
                  label={{
                    value: String(last.remaining),
                    position: 'top', // above the point: clear of the ideal line beside it
                    offset: 10,
                    fill: 'var(--foreground)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}

function BurndownTooltip(props: { active: boolean; point?: ChartPoint; unit: ReportUnit }) {
  const p = props.point;
  if (!props.active || !p) return null;
  const change = scopeChangeText(p.scopeChange, props.unit);
  const row = (name: string, color: string, value: number | null, dashed = false) => (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block w-3 border-t-2"
        style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }}
      />
      <span className="text-muted-foreground">{name}</span>
      <span className="ml-auto pl-4 font-medium tabular-nums">{value ?? '–'}</span>
    </div>
  );
  return (
    <div className="min-w-44 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">End of {dayLabel(p.day)}</p>
      {row('Remaining', 'var(--chart-actual)', p.remaining)}
      {row('Ideal', 'var(--chart-ideal)', p.ideal, true)}
      {row('Scope', 'var(--chart-scope)', p.scope)}
      {change && <p className="mt-1 text-muted-foreground">{change}</p>}
    </div>
  );
}

function BurndownTable({ data, unit }: { data: ChartPoint[]; unit: ReportUnit }) {
  return (
    <div className="max-h-80 overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">Burndown in {unit}</caption>
        <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Day</th>
            <th className="px-3 py-2 text-right font-medium">Remaining</th>
            <th className="px-3 py-2 text-right font-medium">Ideal</th>
            <th className="px-3 py-2 text-right font-medium">Scope</th>
            <th className="px-3 py-2 font-medium">Scope change</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {data.map((p) => (
            <tr key={p.day} className="border-t">
              <td className="px-3 py-1.5">{dayLabel(p.day)}</td>
              <td className="px-3 py-1.5 text-right">{p.remaining ?? '–'}</td>
              <td className="px-3 py-1.5 text-right">{p.ideal ?? '–'}</td>
              <td className="px-3 py-1.5 text-right">{p.scope}</td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {scopeChangeText(p.scopeChange, unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
