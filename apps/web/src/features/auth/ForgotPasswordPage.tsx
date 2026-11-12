import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router';
import { forgotPasswordSchema } from '@teamboard/shared';
import { http } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormError, FormField, fieldA11y } from '@/components/FormField';
import { applyServerErrors } from '@/lib/formErrors';
import { AuthCard } from './AuthCard';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const { errors } = formState;

  const onSubmit = handleSubmit((v) =>
    http
      .post('/auth/forgot-password', v)
      .then(() => setSent(true))
      .catch((e: unknown) => applyServerErrors(e, setError)),
  );

  if (sent) {
    return (
      <AuthCard title="Check your email">
        {/* Same message whether or not the account exists (no email enumeration). */}
        <p className="text-sm text-muted-foreground">
          If an account exists for that email, we sent a link to reset your password. It expires in
          30 minutes.
        </p>
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link to="/login">Back to log in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Forgot your password?" description="We'll email you a link to reset it.">
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
        <FormError message={errors.root?.message} />
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className="text-primary underline-offset-4 hover:underline">
          Back to log in
        </Link>
      </p>
    </AuthCard>
  );
}
