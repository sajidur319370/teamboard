import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from './logger';

/** Gives every request `req.id` (echoed as `x-request-id`) and a request-scoped `req.log`. */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && incoming.length > 0 && incoming.length < 100
        ? incoming
        : `req_${randomUUID()}`;
    res.setHeader('x-request-id', id);
    return id;
  },
  // AC-AUTH-05: tokens and cookies must never appear in logs
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
});
