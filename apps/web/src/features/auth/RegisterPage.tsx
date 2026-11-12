import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useSearchParams } from 'react-router';
import { registerSchema } from '@teamboard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormError, FormField, fieldA11y } from '@/components/FormField';
import { applyServerErrors } from '@/lib/formErrors';
import { safeReturnTo } from '@/lib/safeReturnTo';
import { AuthCard } from './AuthCard';
import { useRegister } from './useAuthActions';

export function RegisterPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const signUp = useRegister(returnTo);
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });
  const { errors } = formState;

  const onSubmit = handleSubmit((v) =>
    // EMAIL_TAKEN is a 409, not a validation error, but it belongs under the email field.
    signUp
      .mutateAsync(v)
      .catch((e: unknown) => applyServerErrors(e, setError, { EMAIL_TAKEN: 'email' })),
  );

  return (
    <AuthCard title="Create your account" description="Set up a workspace for your team next.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField id="name" label="Name" error={errors.name?.message}>
          <Input
            {...fieldA11y('name', errors.name?.message)}
            autoComplete="name"
            autoFocus
            {...register('name')}
          />
        </FormField>
        <FormField id="email" label="Email" error={errors.email?.message}>
          <Input
            {...fieldA11y('email', errors.email?.message)}
            type="email"
            autoComplete="email"
            {...register('email')}
          />
        </FormField>
        <FormField
          id="password"
          label="Password"
          error={errors.password?.message}
          hint="8–72 characters, with at least one letter and one digit."
        >
          <Input
            {...fieldA11y('password', errors.password?.message)}
            type="password"
            autoComplete="new-password"
            {...register('password')}
          />
        </FormField>
        <FormError message={errors.root?.message} />
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
