import { Router, type Request } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  type AuthResponse,
  type RefreshResponse,
  DEMO_ROLES,
  demoEmail,
  demoLoginSchema,
  type DemoInfo,
} from '@teamboard/shared';
import { validate, valid } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { authLimiter, demoLoginLimiter, loginLimiter } from '../../middleware/rateLimits';
import { env } from '../../config/env';
import { assertNotDemoAccount } from '../../demo/guard';
import { demoResetDone } from '../../demo/autoReset';
import { notFound } from '../../lib/errors';
import * as auth from './auth.service';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from './cookies';

const meta = (req: Request): auth.ClientMeta => ({
  userAgent: req.get('user-agent') ?? '',
  ip: req.ip ?? '',
});

const cookie = (req: Request): string | undefined => {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
};

export const authRouter = Router();

const registerReq = { body: registerSchema };
authRouter.post('/register', authLimiter, validate(registerReq), async (req, res) => {
  const { user, accessToken, refreshToken } = await auth.register(
    valid(req, registerReq).body,
    meta(req),
  );
  setRefreshCookie(res, refreshToken);
  res.status(201).json({ user, accessToken } satisfies AuthResponse);
});

const loginReq = { body: loginSchema };
authRouter.post('/login', loginLimiter, validate(loginReq), async (req, res) => {
  const { user, accessToken, refreshToken } = await auth.login(
    valid(req, loginReq).body,
    meta(req),
  );
  setRefreshCookie(res, refreshToken);
  res.json({ user, accessToken } satisfies AuthResponse);
});

// ---- DEMO_MODE: one-click logins on the login page ----
authRouter.get('/demo', (_req, res) => {
  const info: DemoInfo = env.DEMO_MODE
    ? {
        enabled: true,
        accounts: DEMO_ROLES.map((role) => ({ role, email: demoEmail(role) })),
        resetHours: env.DEMO_RESET_HOURS || null,
      }
    : { enabled: false, accounts: [], resetHours: null };
  res.json(info);
});

const demoReq = { body: demoLoginSchema };
authRouter.post('/demo', demoLoginLimiter, validate(demoReq), async (req, res) => {
  if (!env.DEMO_MODE) throw notFound();
  await demoResetDone(); // a reset in progress: wait for the fresh demo, don't fail
  const { user, accessToken, refreshToken } = await auth.loginDemo(
    valid(req, demoReq).body.role,
    meta(req),
  );
  setRefreshCookie(res, refreshToken);
  res.json({ user, accessToken } satisfies AuthResponse);
});

authRouter.post('/refresh', async (req, res) => {
  try {
    const { accessToken, refreshToken } = await auth.refresh(cookie(req), meta(req));
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken } satisfies RefreshResponse);
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
});

authRouter.post('/logout', async (req, res) => {
  await auth.logout(cookie(req));
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.post('/logout-all', authenticate, async (req, res) => {
  await assertNotDemoAccount(req.userId); // would sign out every visitor sharing the account
  await auth.logoutAll(req.userId);
  clearRefreshCookie(res);
  res.status(204).end();
});

const forgotReq = { body: forgotPasswordSchema };
authRouter.post('/forgot-password', authLimiter, validate(forgotReq), async (req, res) => {
  await auth.forgotPassword(valid(req, forgotReq).body.email);
  res.json({ ok: true }); // always 200
});

const resetReq = { body: resetPasswordSchema };
authRouter.post('/reset-password', authLimiter, validate(resetReq), async (req, res) => {
  const { token, password } = valid(req, resetReq).body;
  await auth.resetPassword(token, password);
  res.json({ ok: true });
});
