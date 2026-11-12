import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/api/client';

/**
 * Shows server errors on the right form field.
 * - VALIDATION_ERROR details go under their fields (server field names = form field names).
 * - `codeToField` puts other known codes on a field, e.g. { WRONG_PASSWORD: 'currentPassword' }.
 * - Anything else becomes a form-level ("root") error.
 */
export function applyServerErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  codeToField: Partial<Record<string, Path<T>>> = {},
) {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
      for (const d of err.details as { field: string; message: string }[]) {
        setError((d.field || 'root') as Path<T>, { message: d.message });
      }
      return;
    }
    const field = codeToField[err.code];
    if (field) {
      setError(field, { message: err.message });
      return;
    }
  }
  setError('root' as Path<T>, {
    message: err instanceof Error ? err.message : 'Something went wrong',
  });
}
