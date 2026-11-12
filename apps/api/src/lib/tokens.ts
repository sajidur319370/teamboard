import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { unauthenticated } from './errors';

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

/** Claims are only `sub` (userId) and `sid` (sessionId). No role: roles are loaded per request (FR-AUTH-04). */
export function signAccessToken({ userId, sessionId }: AccessClaims): string {
  return jwt.sign({ sid: sessionId }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL_SEC,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    // Pinning the algorithm blocks "alg: none" and algorithm-confusion tricks.
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (
      typeof payload === 'string' ||
      !payload.sub ||
      !Types.ObjectId.isValid(payload.sub) ||
      typeof payload.sid !== 'string' ||
      !Types.ObjectId.isValid(payload.sid)
    ) {
      throw unauthenticated();
    }
    return { userId: payload.sub, sessionId: payload.sid };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthenticated('TOKEN_EXPIRED', 'Your session expired.');
    }
    throw unauthenticated();
  }
}
