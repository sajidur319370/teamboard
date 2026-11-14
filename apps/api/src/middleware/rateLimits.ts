import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../lib/errors';

/** Abuse protection on register/forgot/reset (one shared budget per IP). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, _res, next) =>
    next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.')),
});

/**
 * A ceiling for everything else under /api (NFR-SEC): 300 requests a minute per IP is
 * far above what a person clicking around needs (a board load is ~3 requests), and stops
 * a script hammering the API from one address.
 */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Slow down a little.')),
});

/**
 * Brute-force protection on login: only FAILED attempts count. A correct password never
 * locks anyone out, so a team (or a demo audience) logging in from one office IP is fine,
 * while guessing passwords is still capped at 10 tries per 15 minutes per IP.
 */
export const createLoginLimiter = (limit = 10, enabled = env.NODE_ENV !== 'test') =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => !enabled,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many failed attempts. Try again later.')),
  });
export const loginLimiter = createLoginLimiter();
