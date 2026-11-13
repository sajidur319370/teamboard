import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { createSprintSchema, todayIn, type SprintDto } from '@teamboard/shared';
import { FormError, FormField, fieldA11y } from '@/components/FormField';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspace } from '@/features/workspace/WorkspaceContext';
import { applyServerErrors } from '@/lib/formErrors';
import { useCreateSprint, useUpdateSprint } from './api';

type Values = z.input<typeof createSprintSchema>;
const plusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * FR-SPR-01/02: create a sprint, or edit one. The SAME shared schema as the API checks the
 * 1–28 day range, so the message appears before any request. A running sprint keeps its
 * start date.
 */
export function SprintFormDialog(props: {
  slug: string;
  projectKey: string;
  trigger: ReactNode;
  sprint?: SprintDto; // edit mode
  nextNumber?: number; // create: the "Sprint N" placeholder
}) {
  const { slug, projectKey, sprint } = props;
  const { workspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const create = useCreateSprint(slug, projectKey);
  const update = useUpdateSprint(slug, projectKey);
  const today = todayIn(workspace.settings.timezone, new Date());
  const initial: Values = sprint
    ? { name: sprint.name, goal: sprint.goal, startDate: sprint.startDate, endDate: sprint.endDate }
    : { name: '', goal: '', startDate: today, endDate: plusDays(today, 13) }; // 2 weeks

  const { register, handleSubmit, setError, reset, formState } = useForm<Values>({
    resolver: zodResolver(createSprintSchema),
    defaultValues: initial,
  });
  const { errors, isSubmitting } = formState;
  const running = sprint?.state === 'active';

  const onSubmit = handleSubmit(async (v) => {
    const name = v.name?.trim() || undefined; // empty → "Sprint N"
    try {
      if (sprint) {
        await update.mutateAsync({
          id: sprint.id,
          ...(name && { name }),
          goal: v.goal ?? '',
          endDate: v.endDate,
          ...(!running && { startDate: v.startDate }),
        });
        toast.success('Sprint updated');
      } else {
        await create.mutateAsync({
          ...v,
          goal: v.goal ?? '',
          ...(name ? { name } : { name: undefined }),
        });
        toast.success('Sprint created');
      }
      setOpen(false);
    } catch (e) {
      applyServerErrors(e, setError, { INVALID_DATES: 'endDate' });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset(initial);
      }}
    >
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{sprint ? `Edit ${sprint.name}` : 'New sprint'}</DialogTitle>
          <DialogDescription>
            {running
              ? 'A running sprint keeps its start date. Name, goal and end date can change.'
              : 'Between 1 and 28 days long.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField id="sprint-name" label="Name" error={errors.name?.message}>
            <Input
              {...fieldA11y('sprint-name', errors.name?.message)}
              placeholder={props.nextNumber ? `Sprint ${props.nextNumber}` : 'Sprint name'}
              maxLength={60}
              {...register('name')}
            />
          </FormField>
          <FormField id="sprint-goal" label="Goal (optional)" error={errors.goal?.message}>
            <Textarea
              {...fieldA11y('sprint-goal', errors.goal?.message)}
              rows={2}
              maxLength={500}
              placeholder="What should this sprint achieve?"
              {...register('goal')}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="sprint-start" label="Start" error={errors.startDate?.message}>
              <Input
                type="date"
                disabled={running}
                {...fieldA11y('sprint-start', errors.startDate?.message)}
                {...register('startDate')}
              />
            </FormField>
            <FormField id="sprint-end" label="End" error={errors.endDate?.message}>
              <Input
                type="date"
                {...fieldA11y('sprint-end', errors.endDate?.message)}
                {...register('endDate')}
              />
            </FormField>
          </div>
          <FormError message={errors.root?.message} />
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {sprint ? 'Save' : 'Create sprint'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
