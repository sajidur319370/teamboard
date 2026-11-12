import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  transferOwnershipSchema,
  updateWorkspaceSchema,
  type WorkspaceDto,
} from '@teamboard/shared';
import { FormError, FormField, fieldA11y } from '@/components/FormField';
import { TimezoneSelect } from '@/components/TimezoneSelect';
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
import { applyServerErrors } from '@/lib/formErrors';
import { WEEKDAYS } from '@/lib/format';
import { forgetWorkspace } from '@/lib/lastWorkspace';
import { cn } from '@/lib/utils';
import { Can, useCan, useWorkspace } from './WorkspaceContext';
import { useDeleteWorkspace, useMembers, useTransferOwnership, useUpdateWorkspace } from './api';

export function SettingsPage() {
  const { workspace } = useWorkspace();
  return (
    <div className="max-w-2xl space-y-6 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      {/* key: re-mount the form when the saved values change, so defaults stay in sync */}
      <GeneralCard key={JSON.stringify(workspace)} workspace={workspace} />
      <Can perm="workspace:transferOwnership">
        <TransferCard />
      </Can>
      <Can perm="workspace:delete">
        <DeleteCard />
      </Can>
    </div>
  );
}

function GeneralCard({ workspace }: { workspace: WorkspaceDto }) {
  const editable = useCan()('workspace:update');
  const update = useUpdateWorkspace(workspace.slug);
  const { register, control, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(updateWorkspaceSchema),
    defaultValues: {
      name: workspace.name,
      timezone: workspace.settings.timezone,
      weekStartsOn: workspace.settings.weekStartsOn,
      workingDays: workspace.settings.workingDays,
    },
  });
  const { errors, dirtyFields } = formState;

  const onSubmit = handleSubmit(async (v) => {
    // Only send what changed, so the activity log records the real change.
    const changed = Object.fromEntries(
      Object.entries(v).filter(([k]) => dirtyFields[k as keyof typeof dirtyFields]),
    );
    try {
      await update.mutateAsync(changed);
      toast.success('Settings saved');
    } catch (e) {
      applyServerErrors(e, setError);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>
          {editable
            ? 'The timezone and working days decide what "a day" means in sprint reports.'
            : 'Only Admins and the Owner can change these.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <fieldset disabled={!editable} className="space-y-4">
            <FormField id="ws-name" label="Workspace name" error={errors.name?.message}>
              <Input {...fieldA11y('ws-name', errors.name?.message)} {...register('name')} />
            </FormField>
            <p className="-mt-2 text-xs text-muted-foreground">
              URL: /w/{workspace.slug} (can't be changed)
            </p>

            <FormField id="ws-tz" label="Timezone" error={errors.timezone?.message}>
              <Controller
                control={control}
                name="timezone"
                render={({ field }) => (
                  <TimezoneSelect
                    id="ws-tz"
                    value={field.value}
                    onChange={field.onChange}
                    disabled={!editable}
                  />
                )}
              />
            </FormField>

            <FormField id="ws-week" label="Week starts on" error={errors.weekStartsOn?.message}>
              <Controller
                control={control}
                name="weekStartsOn"
                render={({ field }) => (
                  <Select
                    value={String(field.value ?? 1)}
                    onValueChange={(v) => field.onChange(Number(v))}
                    disabled={!editable}
                  >
                    <SelectTrigger id="ws-week" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((d, i) => (
                        <SelectItem key={d} value={String(i)}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Working days</legend>
              <Controller
                control={control}
                name="workingDays"
                render={({ field }) => {
                  const days = field.value ?? [];
                  return (
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAYS.map((d, i) => {
                        const on = days.includes(i);
                        return (
                          <button
                            key={d}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              field.onChange(on ? days.filter((x) => x !== i) : [...days, i])
                            }
                            className={cn(
                              'rounded-md border px-2.5 py-1 text-sm transition disabled:opacity-60',
                              on
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'hover:bg-muted',
                            )}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  );
                }}
              />
              {errors.workingDays && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.workingDays.message}
                </p>
              )}
            </fieldset>

            <FormError message={errors.root?.message} />
            {editable && (
              <Button type="submit" disabled={formState.isSubmitting || !formState.isDirty}>
                {formState.isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            )}
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}

function TransferCard() {
  const { workspace } = useWorkspace();
  const members = useMembers(workspace.slug);
  const transfer = useTransferOwnership(workspace.slug);
  const admins = members.data?.filter((m) => m.role === 'admin') ?? [];

  const { register, control, handleSubmit, setError, reset, formState } = useForm({
    resolver: zodResolver(transferOwnershipSchema),
    defaultValues: { userId: '', password: '' },
  });
  const { errors } = formState;

  const onSubmit = handleSubmit(async (v) => {
    try {
      await transfer.mutateAsync(v);
      reset();
      const name = admins.find((a) => a.userId === v.userId)?.name ?? 'They';
      toast.success(`${name} is now the owner. You're an Admin.`);
    } catch (e) {
      applyServerErrors(e, setError, {
        WRONG_PASSWORD: 'password',
        TARGET_MUST_BE_ADMIN: 'userId',
      });
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer ownership</CardTitle>
        <CardDescription>
          The new owner must be an Admin. You'll become an Admin. There is always exactly one owner.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {members.isSuccess && admins.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Make someone an Admin on the Members page first.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField id="transfer-to" label="New owner" error={errors.userId?.message}>
              <Controller
                control={control}
                name="userId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="transfer-to" className="w-full">
                      <SelectValue placeholder="Choose an Admin" />
                    </SelectTrigger>
                    <SelectContent>
                      {admins.map((a) => (
                        <SelectItem key={a.userId} value={a.userId}>
                          {a.name} ({a.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormField id="transfer-pw" label="Your password" error={errors.password?.message}>
              <Input
                {...fieldA11y('transfer-pw', errors.password?.message)}
                type="password"
                autoComplete="current-password"
                {...register('password')}
              />
            </FormField>
            <FormError message={errors.root?.message} />
            <Button type="submit" variant="outline" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? 'Transferring…' : 'Transfer ownership'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function DeleteCard() {
  const { workspace } = useWorkspace();
  const del = useDeleteWorkspace(workspace.slug);
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const matches = typed === workspace.name;

  const onDelete = async () => {
    try {
      await del.mutateAsync(typed);
      forgetWorkspace(workspace.slug);
      toast.success(`${workspace.name} was deleted`);
      navigate('/workspaces?all=1', { replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete the workspace");
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Delete workspace</CardTitle>
        <CardDescription>
          Everyone loses access immediately. All projects, tasks and history are removed after 30
          days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <FormField id="delete-confirm" label={`Type "${workspace.name}" to confirm`}>
          <Input
            id="delete-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </FormField>
        <Button variant="destructive" disabled={!matches || del.isPending} onClick={onDelete}>
          {del.isPending ? 'Deleting…' : 'Delete this workspace'}
        </Button>
      </CardContent>
    </Card>
  );
}
