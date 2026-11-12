// Extra fields our middleware adds to `req`. More are added on Days 3 and 5.
// (`req.id` and `req.log` come from pino-http's own type augmentation.)
declare global {
  namespace Express {
    interface Request {
      /** Set by validate(); read it through valid(req, schemas) for proper types. */
      valid: unknown;
    }
  }
}

export {};
