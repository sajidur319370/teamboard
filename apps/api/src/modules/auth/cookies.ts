import type { Response } from 'express';
import { isProd } from '../../config/env';
import { REFRESH_DAYS } from './auth.service';

export const REFRESH_COOKIE = 'tb_refresh';

const options = {
  httpOnly: true, // JavaScript can't read it, so XSS can't steal it
  secure: isProd, // HTTPS only in production (dev runs on plain http://localhost)
  sameSite: 'lax' as const,
  path: '/api/auth', // the browser sends it ONLY to auth endpoints
};

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, { ...options, maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000 });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, options);
}
