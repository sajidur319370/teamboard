import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  PALETTE,
  changePasswordSchema,
  updateMeSchema,
  type ChangePasswordInput,
  type MeResponse,
  type UpdateMeInput,
  type UserDto,
} from '@teamboard/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { AppHeader } from '@/components/AppHeader';
import { FormError, FormField, fieldA11y } from '@/components/FormField';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { applyServerErrors } from '@/lib/formErrors';
import { AVATAR_BG } from '@/lib/colors';
import { cn } from '@/lib/utils';
import { useLogout } from './useAuthActions';
import { useMe } from './useMe';

export function ProfilePage() {
  const { data } = useMe(); // RequireAuth guarantees data is loaded
  if (!data) return null;
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-2xl space-y-6 p-4 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Your profile</h1>
        <ProfileForm user={data.user} />
        <PasswordForm />
        <SessionsCard />
      </main>
    </>
  );
}

function ProfileForm({ user }: { user: UserDto }) {
  const qc = useQueryClient();
  const { register, control, handleSubmit, setError, reset, formState } = useForm({
    resolver: zodResolver(updateMeSchema),
    defaultValues: { name: user.name, avatarColor: user.avatarColor, timezone: user.timezone },
  });
  const { errors } = formState;
  const [name, color] = useWatch({ control, name: ['name', 'avatarColor'] });

  const save = useMutation({
    mutationFn: (v: UpdateMeInput) => http.patch<{ user: UserDto }>('/me', v),
    onSuccess: ({ user: next }) => {
      qc.setQueryData<MeResponse | null>(qk.me, (old) => (old ? { ...old, user: next } : old));
      reset({ name: next.name, avatarColor: next.avatarColor, timezone: next.timezone });
      toast.success('Profile saved');
    },
  });

  const onSubmit = handleSubmit((v) =>
    save.mutateAsync(v).catch((e: unknown) => applyServerErrors(e, setError)),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>{user.email}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <div className="flex items-center gap-4">
            <UserAvatar name={name || user.name} color={color ?? 'blue'} className="size-14" />
            <FormField id="name" label="Name" error={errors.name?.message}>
              <Input
                {...fieldA11y('name', errors.name?.message)}
                autoComplete="name"
                {...register('name')}
              />
            </FormField>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Avatar color</legend>
            <Controller
              control={control}
              name="avatarColor"
              render={({ field }) => (
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Avatar color">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={field.value === c}
                      aria-label={c}
                      title={c}
                      onClick={() => field.onChange(c)}
                      className={cn(
                        'size-7 rounded-full ring-offset-2 ring-offset-background transition',
                        AVATAR_BG[c],
                        field.value === c ? 'ring-2 ring-foreground' : 'hover:scale-110',
                      )}
                    />
                  ))}
                </div>
              )}
            />
          </fieldset>

          <FormField
            id="timezone"
            label="Timezone"
            error={errors.timezone?.message}
            hint="Used for due dates and report days."
          >
            <Controller
              control={control}
              name="timezone"
              render={({ field }) => (
                <TimezoneSelect id="timezone" value={field.value} onChange={field.onChange} />
              )}
            />
          </FormField>

          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={formState.isSubmitting || !formState.isDirty}>
            {formState.isSubmitting ? 'Saving…' : 'Save profile'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordForm() {
  const { register, handleSubmit, setError, reset, formState } = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const { errors } = formState;

  const change = useMutation({
    mutationFn: (v: ChangePasswordInput) => http.patch('/me/password', v),
    onSuccess: () => {
      reset();
      toast.success('Password changed. Your other devices were logged out.');
    },
  });

  const onSubmit = handleSubmit((v) =>
    change
      .mutateAsync(v)
      .catch((e: unknown) => applyServerErrors(e, setError, { WRONG_PASSWORD: 'currentPassword' })),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>This logs you out everywhere except this browser.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField
            id="currentPassword"
            label="Current password"
            error={errors.currentPassword?.message}
          >
            <Input
              {...fieldA11y('currentPassword', errors.currentPassword?.message)}
              type="password"
              autoComplete="current-password"
              {...register('currentPassword')}
            />
          </FormField>
          <FormField
            id="newPassword"
            label="New password"
            error={errors.newPassword?.message}
            hint="8–72 characters, with at least one letter and one digit."
          >
            <Input
              {...fieldA11y('newPassword', errors.newPassword?.message)}
              type="password"
              autoComplete="new-password"
              {...register('newPassword')}
            />
          </FormField>
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Changing…' : 'Change password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const logout = useLogout();
  const logoutAll = useLogout({ all: true });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Log out of this browser, or of every device at once.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => logout.mutate()} disabled={logout.isPending}>
          Log out
        </Button>
        <Button
          variant="destructive"
          onClick={() => logoutAll.mutate()}
          disabled={logoutAll.isPending}
        >
          Log out of all devices
        </Button>
      </CardContent>
    </Card>
  );
}
