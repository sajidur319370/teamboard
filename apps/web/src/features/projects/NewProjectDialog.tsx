import { useState, type ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router';
import { PlusIcon } from 'lucide-react';
import { createProjectSchema, suggestProjectKey } from '@teamboard/shared';
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
import { useCreateProject } from './api';

const EMPTY: z.input<typeof createProjectSchema> = { name: '', key: '', description: '' };

/** FR-PRJ-01/02: name, key (suggested from the name until you edit it), description. */
export function NewProjectDialog() {
  const { workspace } = useWorkspace();
  const create = useCreateProject(workspace.slug);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [keyTouched, setKeyTouched] = useState(false);

  const { register, setValue, handleSubmit, setError, reset, formState } = useForm({
    resolver: zodResolver(createProjectSchema),
    defaultValues: EMPTY,
  });
  const { errors } = formState;

  const nameField = register('name', {
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      if (!keyTouched) setValue('key', suggestProjectKey(e.target.value));
    },
  });
  const keyField = register('key', {
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setKeyTouched(true);
      setValue('key', e.target.value.toUpperCase());
    },
  });

  const onSubmit = handleSubmit(async (v) => {
    try {
      const { project } = await create.mutateAsync(v);
      setOpen(false);
      navigate(`/w/${workspace.slug}/p/${project.key}/board`);
    } catch (e) {
      applyServerErrors(e, setError, { KEY_TAKEN: 'key' });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          reset(EMPTY);
          setKeyTouched(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <PlusIcon /> New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            It starts with To Do, In Progress, Review and Done columns.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField id="project-name" label="Name" error={errors.name?.message}>
            <Input
              {...fieldA11y('project-name', errors.name?.message)}
              placeholder="Mobile App"
              autoFocus
              {...nameField}
            />
          </FormField>
          <FormField
            id="project-key"
            label="Key"
            error={errors.key?.message}
            hint="Task numbers use it, like MOB-12. It can't be changed later."
          >
            <Input
              {...fieldA11y('project-key', errors.key?.message)}
              className="w-32 font-mono uppercase"
              maxLength={6}
              autoComplete="off"
              spellCheck={false}
              {...keyField}
            />
          </FormField>
          <FormField
            id="project-desc"
            label="Description (optional)"
            error={errors.description?.message}
          >
            <Textarea id="project-desc" rows={3} maxLength={2000} {...register('description')} />
          </FormField>
          <FormError message={errors.root?.message} />
          <DialogFooter>
            <Button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
