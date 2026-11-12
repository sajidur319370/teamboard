// Extra fields our middleware adds to `req`. More are added on Day 5.
// (`req.id` and `req.log` come from pino-http's own type augmentation.)
import type { Types } from 'mongoose';

declare global {
  namespace Express {
    interface Request {
      /** Set by validate(); read it through valid(req, schemas) for proper types. */
      valid: unknown;
      /** Set by authenticate. Only present on routes mounted behind it. */
      userId: Types.ObjectId;
      /** Set by authenticate: the session (refresh token document) this access token belongs to. */
      sessionId: string;
    }
  }
}

export {};
