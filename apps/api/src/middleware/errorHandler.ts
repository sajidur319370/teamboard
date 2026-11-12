import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError, badRequest, notFound } from '../lib/errors';
import { logger } from '../lib/logger';

/** E11000 duplicate-key errors carry the index name → API error (schema.md §15). */
const DUPLICATE_KEY: Record<string, { status: number; code: string }> = {
  uniq_email: { status: 409, code: 'EMAIL_TAKEN' },
  uniq_slug: { status: 409, code: 'SLUG_TAKEN' },
  uniq_member: { status: 409, code: 'ALREADY_MEMBER' },
  uniq_project_key: { status: 409, code: 'KEY_TAKEN' },
  one_active_sprint_per_project: { status: 409, code: 'ACTIVE_SPRINT_EXISTS' },
};

/** Maps anything thrown to an AppError. Unknown errors become a generic 500. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof z.ZodError) {
    return badRequest(
      'VALIDATION_ERROR',
      'Some fields are invalid.',
      err.issues.map((i) => ({
        field: i.path.join('.'),
        // A custom refine can name its own code, e.g. params: { code: 'SLUG_RESERVED' }
        issue:
          (i.code === 'custom' && typeof i.params?.code === 'string' && i.params.code) || i.code,
        message: i.message,
      })),
    );
  }
  if (err instanceof mongoose.Error.CastError) return badRequest('INVALID_ID', 'Invalid id.');
  if (err instanceof mongoose.Error.ValidationError) {
    return badRequest('VALIDATION_ERROR', err.message);
  }

  const e = err as { code?: number; message?: string; type?: string };
  if (e.code === 11000) {
    const index = /index: (\S+)/.exec(e.message ?? '')?.[1];
    const mapped = index ? DUPLICATE_KEY[index] : undefined;
    if (mapped) return new AppError(mapped.status, mapped.code);
    // Unmapped duplicates (task numbers, token hashes…) mean a bug, so they fall through to 500.
  }
  if (e.type === 'entity.parse.failed') {
    return badRequest('INVALID_JSON', 'Request body is not valid JSON.');
  }
  if (e.type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appErr = toAppError(err);
  // The real error goes to the logs only; the client gets the generic message.
  // req.log is missing if httpLogger didn't run (e.g. a bare test app), hence the fallback.
  if (appErr.status >= 500) (req.log ?? logger).error({ err }, 'unhandled error');
  res.status(appErr.status).json({
    error: {
      code: appErr.code,
      message: appErr.message,
      details: appErr.details,
      requestId: req.id,
    },
  });
};

export const notFoundHandler: RequestHandler = (_req, _res, next) =>
  next(notFound('Route not found.'));
