import { useMemo } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router';
import { ArchiveIcon } from 'lucide-react';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan, useWorkspace } from '@/features/workspace/WorkspaceContext';
import { BoardProvider, type BoardCtx, type Person } from './BoardContext';
import { BoardColumn } from './BoardColumn';
import { useBoard } from './api';
import { groupByColumn } from './grouping';

/**
 * /w/:slug/p/:key/board and /w/:slug/p/:key/tasks/:number (the drawer is a child route,
 * so a task URL opens the board WITH the drawer: FR-TSK-07). The sprint view lives in
 * the search params, so opening/closing the drawer never refetches the board.
 */
export function BoardPage() {
  const { slug = '', key = '' } = useParams();
  const { search } = useLocation();
  const sprint = new URLSearchParams(search).get('sprint') ?? 'active';
  const { workspace } = useWorkspace();
  const canEdit = useCan()('task:update');
  const board = useBoard(slug, key, sprint);

  const ctx = useMemo<BoardCtx | null>(() => {
    if (!board.data) return null;
    const people = new Map<string, Person>();
    for (const f of board.data.formerMembers) people.set(f.userId, { ...f, former: true });
    for (const m of board.data.members) people.set(m.userId, m);
    const base = `/w/${slug}/p/${board.data.project.key}`;
    return {
      board: board.data,
      slug,
      projectKey: board.data.project.key,
      people,
      assignable: board.data.members.filter((m) => m.role !== 'viewer'),
      labels: new Map(board.data.project.labels.map((l) => [l.id, l])),
      tz: workspace.settings.timezone,
      readOnly: !canEdit || !!board.data.project.archivedAt,
      boardPath: `${base}/board${search}`,
      taskPath: (n: number) => `${base}/tasks/${n}${search}`,
    };
  }, [board.data, slug, search, workspace.settings.timezone, canEdit]);

  const columns = useMemo(() => (board.data ? groupByColumn(board.data) : {}), [board.data]);

  if (board.isPending) return <BoardSkeleton />;
  if (board.error || !ctx) {
    const missing = board.error instanceof ApiError && board.error.status === 404;
    return (
      <div className="space-y-3 p-6">
        <p className={missing ? 'text-muted-foreground' : 'text-destructive'}>
          {missing ? "This project doesn't exist, or it was deleted." : board.error?.message}
        </p>
        <Button asChild variant="outline">
          <Link to={`/w/${slug}/projects`}>All projects</Link>
        </Button>
      </div>
    );
  }

  const { project } = ctx.board;
  return (
    <BoardProvider value={ctx}>
      <div className="flex h-full flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
          <h1 className="text-lg font-semibold">{project.name}</h1>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            {project.key}
          </span>
          {project.archivedAt && (
            <span className="flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-sm text-amber-900">
              <ArchiveIcon className="size-3.5" /> Archived: read-only
            </span>
          )}
          {/* Day 11: <FilterBar />  ·  Day 19: <SprintSelector /> */}
        </header>
        <div
          className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 sm:p-4"
          role="region"
          aria-label={`${project.name} board`}
        >
          {project.columns.map((col) => (
            <BoardColumn key={col.id} column={col} tasks={columns[col.id] ?? []} />
          ))}
        </div>
        <Outlet /> {/* the task drawer, when the URL is …/tasks/:number */}
      </div>
    </BoardProvider>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 p-4" aria-busy="true" aria-label="Loading board">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-64 w-72 shrink-0" />
      ))}
    </div>
  );
}
