import { Link } from 'react-router';
import { FolderKanbanIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Can, useWorkspace } from '@/features/workspace/WorkspaceContext';
import { NewProjectDialog } from './NewProjectDialog';
import { useProjects } from './api';

/** FR-PRJ-04: the workspace's active projects, each linking to its board. */
export function ProjectsPage() {
  const { workspace } = useWorkspace();
  const projects = useProjects(workspace.slug);

  return (
    <div className="max-w-4xl p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Can perm="project:create">
          <NewProjectDialog />
        </Can>
      </div>

      {projects.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : projects.error ? (
        <p className="text-destructive">{projects.error.message}</p>
      ) : projects.data.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <FolderKanbanIcon className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-medium">No projects yet</p>
          <Can
            perm="project:create"
            fallback={
              <p className="mt-1 text-sm text-muted-foreground">An Admin can create one.</p>
            }
          >
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first project to get a board.
            </p>
          </Can>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.map((p) => (
            <li key={p.id}>
              <Link
                to={`/w/${workspace.slug}/p/${p.key}/board`}
                className="block h-full rounded-lg border p-4 transition hover:border-foreground/30 hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{p.name}</p>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{p.key}</span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {p.openTasks} open {p.openTasks === 1 ? 'task' : 'tasks'}
                  {p.activeSprint && ` · ${p.activeSprint.name}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
