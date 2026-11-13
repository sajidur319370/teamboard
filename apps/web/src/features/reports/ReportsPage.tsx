import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ArrowLeftIcon, InfoIcon, SnowflakeIcon } from 'lucide-react';
import type { ReportUnit, SprintDto, SprintSummaryReportDto } from '@teamboard/shared';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useSprints } from '@/features/sprints/api';
import { dayRange, plural, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBurndown, useMemberReport, useSummaryReport } from './api';
import { BurndownChart } from './BurndownChart';
import { MembersChart } from './MembersChart';
import { toChartPoints } from './chartData';

/**
 * /w/:slug/p/:key/reports/:sprintId? (FR-RPT, journey J5: every role can read it).
 * Without a sprint id: the running sprint, else the latest completed one.
 */
export default function ReportsPage() {
  const { slug = '', key = '', sprintId } = useParams();
  const sprints = useSprints(slug, key);
  const reportable = useMemo(
    () => (sprints.data ?? []).filter((s) => s.state !== 'planned'), // active first, then newest
    [sprints.data],
  );

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link to={`/w/${slug}/p/${key}/board`}>
        <ArrowLeftIcon /> Board
      </Link>
    </Button>
  );

  if (sprints.isPending) return <PageSkeleton />;
  if (sprints.error) {
    return (
      <div className="space-y-3 p-6">
        {back}
        <p className="text-muted-foreground">
          {sprints.error instanceof ApiError && sprints.error.status === 404
            ? "This project doesn't exist, or it was deleted."
            : sprints.error.message}
        </p>
      </div>
    );
  }
  if (!sprintId && reportable[0]) {
    return <Navigate to={`/w/${slug}/p/${key}/reports/${reportable[0].id}`} replace />;
  }
  const sprint = reportable.find((s) => s.id === sprintId);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        {back}
        <h1 className="text-xl font-semibold">Sprint reports</h1>
        {reportable.length > 0 && (
          <SprintPicker slug={slug} projectKey={key} sprints={reportable} value={sprintId} />
        )}
      </div>
      {reportable.length === 0 ? (
        <p className="text-muted-foreground">
          Reports appear once a sprint starts.{' '}
          <Link to={`/w/${slug}/p/${key}/backlog`} className="underline">
            Plan one in the backlog
          </Link>
          .
        </p>
      ) : !sprint ? (
        <p className="text-muted-foreground">
          That sprint has no report (it may not have started).
        </p>
      ) : (
        <SprintReport slug={slug} sprint={sprint} />
      )}
    </div>
  );
}

function SprintPicker(props: {
  slug: string;
  projectKey: string;
  sprints: SprintDto[];
  value?: string;
}) {
  const navigate = useNavigate();
  return (
    <Select
      value={props.value}
      onValueChange={(id) => void navigate(`/w/${props.slug}/p/${props.projectKey}/reports/${id}`)}
    >
      <SelectTrigger size="sm" className="ml-auto w-auto min-w-44" aria-label="Sprint">
        <SelectValue placeholder="Choose a sprint" />
      </SelectTrigger>
      <SelectContent>
        {props.sprints.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name} {s.state === 'active' ? '(active)' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SprintReport({ slug, sprint }: { slug: string; sprint: SprintDto }) {
  const burndown = useBurndown(slug, sprint.id);
  const members = useMemberReport(slug, sprint.id);
  const summary = useSummaryReport(slug, sprint.id);
  const [unitChoice, setUnitChoice] = useState<ReportUnit | null>(null);
  const unit = unitChoice ?? burndown.data?.unit ?? 'points'; // FR-RPT-03 default from the API
  const chartData = useMemo(
    () => (burndown.data ? toChartPoints(burndown.data.points, unit) : []),
    [burndown.data, unit],
  );
  const frozenAt = summary.data?.frozenAt ?? burndown.data?.frozenAt;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{sprint.name}</span>
        <span>{dayRange(sprint.startDate, sprint.endDate)}</span>
        {sprint.goal && <span>· {sprint.goal}</span>}
        {frozenAt && (
          <span className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
            <SnowflakeIcon className="size-3.5" /> Frozen on {shortDate(frozenAt)}
          </span>
        )}
      </div>

      {summary.data ? (
        <SummaryTiles s={summary.data.summary} unit={unit} />
      ) : (
        <Skeleton className="h-20 w-full" />
      )}

      <section className="space-y-3 rounded-lg border p-4" aria-labelledby="burndown-h">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="burndown-h" className="font-semibold">
            Burndown
          </h2>
          <UnitToggle value={unit} onChange={setUnitChoice} />
        </div>
        {burndown.data && unit === 'points' && burndown.data.unestimated > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <InfoIcon className="size-3.5" />
            {plural(burndown.data.unestimated, 'task')}{' '}
            {burndown.data.unestimated === 1 ? 'has' : 'have'} no estimate and count as 0 points.
          </p>
        )}
        {burndown.error ? (
          <p className="text-sm text-destructive">{burndown.error.message}</p>
        ) : burndown.data ? (
          <BurndownChart data={chartData} unit={unit} />
        ) : (
          <Skeleton className="h-80 w-full" />
        )}
      </section>

      <section className="space-y-3 rounded-lg border p-4" aria-labelledby="members-h">
        <h2 id="members-h" className="font-semibold">
          Completed per member
        </h2>
        {members.data ? (
          <MembersChart members={members.data.members} unit={unit} />
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </section>
    </div>
  );
}

function UnitToggle({ value, onChange }: { value: ReportUnit; onChange: (u: ReportUnit) => void }) {
  return (
    <div className="ml-auto inline-flex rounded-md border p-0.5" role="group" aria-label="Unit">
      {(['points', 'count'] as const).map((u) => (
        <button
          key={u}
          type="button"
          aria-pressed={value === u}
          onClick={() => onChange(u)}
          className={cn(
            'rounded px-2.5 py-1 text-xs',
            value === u
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {u === 'points' ? 'Points' : 'Tasks'}
        </button>
      ))}
    </div>
  );
}

/** FR-RPT-06: stat tiles in the chosen unit. */
function SummaryTiles({ s, unit }: { s: SprintSummaryReportDto; unit: ReportUnit }) {
  const pts = unit === 'points';
  const v = (tasks: number, points: number) => (pts ? points : tasks);
  const tiles: [string, string][] = [
    ['Committed', String(v(s.committedTasks, s.committedPoints))],
    ['Added', `+${v(s.addedTasks, s.addedPoints)}`],
    ['Removed', `−${v(s.removedTasks, s.removedPoints)}`],
    ['Completed', String(v(s.completedTasks, s.completedPoints))],
    ['Carried over', String(v(s.carriedOverTasks, s.carriedOverPoints))],
    ['Completion', `${pts ? s.completionPct.points : s.completionPct.tasks}%`],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-lg border px-3 py-2">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
      <p className="col-span-full -mt-1 text-xs text-muted-foreground">
        In {pts ? 'story points' : 'tasks'}.
      </p>
    </dl>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4 p-6" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
