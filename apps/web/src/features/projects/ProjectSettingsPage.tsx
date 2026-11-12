import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeftIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import { PALETTE, updateProjectSchema, type LabelDto, type ProjectDto } from '@teamboard/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FormError, FormField, fieldA11y } from '@/components/FormField';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Can, useWorkspace } from '@/features/workspace/WorkspaceContext';
import { useMembers } from '@/features/workspace/api';
import { LABEL_DOT } from '@/lib/colors';
import { applyServerErrors } from '@/lib/formErrors';
import { cn } from '@/lib/utils';
import {
  useAddLabel,
  useDeleteLabel,
  useDeleteProject,
  useProject,
  useSetArchived,
  useUpdateLabel,
  useUpdateProject,
} from './api';

const NO_LEAD = '__none';

/** /w/:slug/p/:key/settings: Admin+ project administration. */
export function ProjectSettingsPage() {
  const { key = '' } = useParams();
  const { workspace } = useWorkspace();
  const project = useProject(workspace.slug, key);
  const boardUrl = `/w/${workspace.slug}/p/${key}/board`;

  return (
    <div className="max-w-2xl space-y-6 p-4 sm:p-6">
      <Button asChild variant="ghost" size="sm">
        <Link to={boardUrl}>
          <ArrowLeftIcon /> Back to the board
        </Link>
      </Button>
      {project.isPending ? (
        <Skeleton className="h-64" />
      ) : project.error ? (
        <p className="text-muted-foreground">This project doesn't exist, or it was deleted.</p>
      ) : (
        <Can
          perm="project:update"
          fallback={
            <p className="text-muted-foreground">Only Admins can change project settings.</p>
          }
        >
          <h1 className="text-xl font-semibold">
            {project.data.name}{' '}
            <span className="font-mono text-base text-muted-foreground">{project.data.key}</span>
          </h1>
          {/* key: re-mount when saved values change, so the form's defaults stay in sync */}
          <GeneralCard
            key={JSON.stringify([
              project.data.name,
              project.data.description,
              project.data.leadId,
              project.data.archivedAt,
            ])}
            project={project.data}
          />
          <LabelsCard project={project.data} />
          <ArchiveCard project={project.data} />
          <DeleteCard project={project.data} />
        </Can>
      )}
    </div>
  );
}

function GeneralCard({ project }: { project: ProjectDto }) {
  const { workspace } = useWorkspace();
  const members = useMembers(workspace.slug);
  const update = useUpdateProject(workspace.slug, project.key);
  const archived = !!project.archivedAt;
  const defaults: z.input<typeof updateProjectSchema> = {
    name: project.name,
    description: project.description,
    leadId: project.leadId,
  };
  const { register, control, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(updateProjectSchema),
    defaultValues: defaults,
  });
  const { errors } = formState;

  const onSubmit = handleSubmit(async (v) => {
    try {
      await update.mutateAsync(v);
      toast.success('Project saved');
    } catch (e) {
      applyServerErrors(e, setError, { INVALID_LEAD: 'leadId' });
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>
          The key ({project.key}) can't change: task numbers depend on it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <fieldset disabled={archived} className="space-y-4">
            <FormField id="p-name" label="Name" error={errors.name?.message}>
              <Input {...fieldA11y('p-name', errors.name?.message)} {...register('name')} />
            </FormField>
            <FormField id="p-desc" label="Description" error={errors.description?.message}>
              <Textarea id="p-desc" rows={3} maxLength={2000} {...register('description')} />
            </FormField>
            <FormField id="p-lead" label="Lead" error={errors.leadId?.message}>
              <Controller
                control={control}
                name="leadId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NO_LEAD}
                    onValueChange={(v) => field.onChange(v === NO_LEAD ? null : v)}
                    disabled={archived}
                  >
                    <SelectTrigger id="p-lead" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_LEAD}>No lead</SelectItem>
                      {members.data?.map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormError message={errors.root?.message} />
            <Button type="submit" disabled={formState.isSubmitting || !formState.isDirty}>
              {formState.isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}

function LabelsCard({ project }: { project: ProjectDto }) {
  const { workspace } = useWorkspace();
  const add = useAddLabel(workspace.slug, project.key);
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelDto['color']>('blue');
  const archived = !!project.archivedAt;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Labels</CardTitle>
        <CardDescription>
          Up to 30 per project. Deleting a label removes it from every task.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {project.labels.length === 0 && (
          <p className="text-sm text-muted-foreground">No labels yet.</p>
        )}
        <ul className="space-y-2">
          {project.labels.map((l) => (
            <LabelRow
              key={`${l.id}:${l.name}:${l.color}`}
              label={l}
              projectKey={project.key}
              readOnly={archived}
            />
          ))}
        </ul>
        {!archived && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              add.mutate({ name: name.trim(), color }, { onSuccess: () => setName('') });
            }}
          >
            <ColorPicker value={color} onChange={setColor} label="New label color" />
            <Input
              aria-label="New label name"
              placeholder="New label"
              value={name}
              maxLength={20}
              className="w-44"
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={!name.trim() || add.isPending}>
              Add label
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function LabelRow(props: { label: LabelDto; projectKey: string; readOnly: boolean }) {
  const { workspace } = useWorkspace();
  const update = useUpdateLabel(workspace.slug, props.projectKey);
  const del = useDeleteLabel(workspace.slug, props.projectKey);
  const { label } = props;

  return (
    <li className="flex items-center gap-2">
      <ColorPicker
        value={label.color}
        label={`Color of ${label.name}`}
        disabled={props.readOnly}
        onChange={(c) => update.mutate({ id: label.id, color: c })}
      />
      <Input
        aria-label={`Name of label ${label.name}`}
        defaultValue={label.name}
        maxLength={20}
        className="w-44"
        disabled={props.readOnly}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== label.name) update.mutate({ id: label.id, name: v });
          else e.target.value = label.name;
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {!props.readOnly && (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label={`Delete label ${label.name}`}>
              <Trash2Icon />
            </Button>
          }
          title={`Delete the “${label.name}” label?`}
          description="It will be removed from every task that has it."
          confirmLabel="Delete label"
          destructive
          onConfirm={() => del.mutateAsync(label.id)}
        />
      )}
    </li>
  );
}

function ColorPicker(props: {
  value: LabelDto['color'];
  onChange: (c: LabelDto['color']) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={props.value}
      onValueChange={(v) => props.onChange(v as LabelDto['color'])}
      disabled={props.disabled}
    >
      <SelectTrigger className="w-28" aria-label={props.label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PALETTE.map((c) => (
          <SelectItem key={c} value={c}>
            <span className={cn('size-3 rounded-full', LABEL_DOT[c])} /> {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ArchiveCard({ project }: { project: ProjectDto }) {
  const { workspace } = useWorkspace();
  const setArchived = useSetArchived(workspace.slug, project.key);
  const archived = !!project.archivedAt;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{archived ? 'Unarchive project' : 'Archive project'}</CardTitle>
        <CardDescription>
          {archived
            ? 'Make the project editable again and show it in the projects list.'
            : 'An archived project is read-only for everyone and hidden from the projects list. You can undo this.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          disabled={setArchived.isPending}
          onClick={() =>
            setArchived.mutate(!archived, {
              onSuccess: () => toast.success(archived ? 'Project unarchived' : 'Project archived'),
            })
          }
        >
          {archived ? 'Unarchive' : 'Archive'}
        </Button>
      </CardContent>
    </Card>
  );
}

function DeleteCard({ project }: { project: ProjectDto }) {
  const { workspace } = useWorkspace();
  const del = useDeleteProject(workspace.slug, project.key);
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Delete project</CardTitle>
        <CardDescription>
          Deletes the project with all its tasks and history. This can't be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <FormField id="delete-key" label={`Type "${project.key}" to confirm`}>
          <Input
            id="delete-key"
            value={typed}
            autoComplete="off"
            className="w-40 font-mono uppercase"
            onChange={(e) => setTyped(e.target.value)}
          />
        </FormField>
        <Button
          variant="destructive"
          disabled={typed.trim().toUpperCase() !== project.key || del.isPending}
          onClick={() =>
            del.mutate(typed, {
              onSuccess: () => {
                toast.success(`${project.name} was deleted`);
                navigate(`/w/${workspace.slug}/projects`, { replace: true });
              },
              onError: (e) => toast.error(e.message),
            })
          }
        >
          {del.isPending ? 'Deleting…' : 'Delete this project'}
        </Button>
      </CardContent>
    </Card>
  );
}
