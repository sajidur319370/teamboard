import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useSearchParams } from 'react-router';
import { loginSchema } from '@teamboard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormError, FormField, fieldA11y } from '@/components/FormField';
import { applyServerErrors } from '@/lib/formErrors';
import { safeReturnTo } from '@/lib/safeReturnTo';
import { AuthCard } from './AuthCard';
import { useLogin } from './useAuthActions';

export function LoginPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const login = useLogin(returnTo);
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors } = formState;

  const onSubmit = handleSubmit((v) =>
    login.mutateAsync(v).catch((e: unknown) => applyServerErrors(e, setError)),
  );

  return (
    <AuthCard title="Log in" description="Welcome back to your boards.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField id="email" label="Email" error={errors.email?.message}>
          <Input
            {...fieldA11y('email', errors.email?.message)}
            type="email"
            autoComplete="email"
            autoFocus
            {...register('email')}
          />
        </FormField>
        <FormField id="password" label="Password" error={errors.password?.message}>
          <Input
            {...fieldA11y('password', errors.password?.message)}
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
        </FormField>
        <FormError message={errors.root?.message} />
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link to="/forgot-password" className="text-primary underline-offset-4 hover:underline">
          Forgot password?
        </Link>
        <Link
          to={`/register?returnTo=${encodeURIComponent(returnTo)}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          Create account
        </Link>
      </div>
    </AuthCard>
  );
}
