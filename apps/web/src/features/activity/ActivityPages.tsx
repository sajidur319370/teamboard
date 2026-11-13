import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { ACTION_GROUP_NAMES, type ActionGroup } from '@teamboard/shared';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useProject } from '@/features/projects/api';
import { ActivityFeed } from './ActivityFeed';

const GROUP_LABEL: Record<ActionGroup, string> = {
  tasks: 'Tasks',
  comments: 'Comments',
  members: 'Members',
  sprints: 'Sprints',
};
const isGroup = (g: string | null): g is ActionGroup =>
  !!g && (ACTION_GROUP_NAMES as string[]).includes(g);

/** /w/:slug/activity: everything in the workspace, with group chips (FR-ACT-07). */
export function WorkspaceActivityPage() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const raw = params.get('group');
  const group = isGroup(raw) ? raw : undefined; // in the URL: shareable, survives reloads

  const chip = (value: ActionGroup | undefined, label: string) => (
    <Button
      key={label}
      size="sm"
      variant={group === value ? 'default' : 'outline'}
      aria-pressed={group === value}
      className="rounded-full"
      onClick={() => setParams(value ? { group: value } : {}, { replace: true })}
    >
      {label}
    </Button>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Activity</h1>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
        {chip(undefined, 'All')}
        {ACTION_GROUP_NAMES.map((g) => chip(g, GROUP_LABEL[g]))}
      </div>
      <ActivityFeed slug={slug} filter={{ group }} />
    </div>
  );
}

/** /w/:slug/p/:key/activity: one project's history. */
export function ProjectActivityPage() {
  const { slug = '', key = '' } = useParams();
  const project = useProject(slug, key);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to={`/w/${slug}/p/${key}/board`}>
          <ArrowLeftIcon /> Board
        </Link>
      </Button>
      {project.isPending && <Skeleton className="h-8 w-64" />}
      {project.error && (
        <p className="text-muted-foreground">
          {project.error instanceof ApiError && project.error.status === 404
            ? "This project doesn't exist, or it was deleted."
            : project.error.message}
        </p>
      )}
      {project.data && (
        <>
          <h1 className="text-xl font-semibold">{project.data.name}: activity</h1>
          <ActivityFeed slug={slug} filter={{ projectId: project.data.id }} />
        </>
      )}
    </div>
  );
}
