import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SprintDto, SummaryReportResponse } from '@teamboard/shared';
import { http } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { plural } from '@/lib/format';
import { useCompleteSprint } from './api';

/**
 * FR-SPR-08: shows done vs unfinished, asks where unfinished work goes (backlog or a
 * planned sprint), completes, then opens the (now frozen) report.
 */
export function CompleteSprintDialog(props: {
  slug: string;
  projectKey: string;
  sprint: SprintDto;
  planned: SprintDto[];
}) {
  const { slug, projectKey, sprint, planned } = props;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('backlog');
  const complete = useCompleteSprint(slug, projectKey);
  const navigate = useNavigate();
  const summary = useQuery({
    queryKey: ['w', slug, 'report', sprint.id, 'summary', 'complete-dialog'],
    queryFn: () =>
      http.get<SummaryReportResponse>(`/w/${slug}/sprints/${sprint.id}/reports/summary`),
    enabled: open,
    staleTime: 0,
  });
  const s = summary.data?.summary;
  const total = s ? s.completedTasks + s.carriedOverTasks : 0;

  const submit = () =>
    complete.mutate(
      { id: sprint.id, carryOverTo: target },
      {
        onSuccess: ({ carriedOver }) => {
          setOpen(false);
          toast.success(
            `${sprint.name} completed${carriedOver ? `, ${plural(carriedOver, 'task')} carried over` : ''}.`,
          );
          void navigate(`/w/${slug}/p/${projectKey}/reports/${sprint.id}`);
        },
        onError: (e) => toast.error(e.message),
      },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setTarget('backlog');
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Complete sprint</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete {sprint.name}?</DialogTitle>
          <DialogDescription>
            The report is frozen at this moment: later edits won't change it.
          </DialogDescription>
        </DialogHeader>
        {!s ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              <b>{s.completedTasks}</b> of <b>{total}</b> tasks completed.
              {s.carriedOverTasks > 0 && (
                <> {plural(s.carriedOverTasks, 'unfinished task')} will move to:</>
              )}
            </p>
            {s.carriedOverTasks > 0 && (
              <fieldset className="space-y-2">
                <legend className="sr-only">Move unfinished tasks to</legend>
                {[{ id: 'backlog', name: 'Backlog' }, ...planned].map((o) => (
                  <label key={o.id} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="carry-over"
                      value={o.id}
                      checked={target === o.id}
                      onChange={() => setTarget(o.id)}
                      className="size-4 accent-primary"
                    />
                    {o.name}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!s || complete.isPending}>
            {complete.isPending ? 'Completing…' : 'Complete sprint'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
