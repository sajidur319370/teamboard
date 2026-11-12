import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { resetPasswordSchema } from '@teamboard/shared';
import { http } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormError, FormField, fieldA11y } from '@/components/FormField';
import { applyServerErrors } from '@/lib/formErrors';
import { AuthCard } from './AuthCard';
import { useClearSession } from './useAuthActions';

export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const clearSession = useClearSession();
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: '' },
  });
  const { errors } = formState;

  const onSubmit = handleSubmit((v) =>
    http
      .post('/auth/reset-password', v)
      .then(() => {
        // The server revoked every session, including this browser's: start clean.
        clearSession();
        toast.success('Password changed. Log in with your new password.');
        navigate('/login', { replace: true });
      })
      .catch((e: unknown) => applyServerErrors(e, setError)),
  );

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <input type="hidden" {...register('token')} />
        <FormField
          id="password"
          label="New password"
          error={errors.password?.message}
          hint="8–72 characters, with at least one letter and one digit."
        >
          <Input
            {...fieldA11y('password', errors.password?.message)}
            type="password"
            autoComplete="new-password"
            autoFocus
            {...register('password')}
          />
        </FormField>
        {/* A malformed token fails the schema; an expired one comes back as INVALID_OR_EXPIRED_TOKEN. */}
        <FormError
          message={
            errors.root?.message ??
            (errors.token ? 'This reset link is invalid or has expired.' : undefined)
          }
        />
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Saving…' : 'Set new password'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link to="/forgot-password" className="text-primary underline-offset-4 hover:underline">
          Request a new link
        </Link>
      </p>
    </AuthCard>
  );
}
