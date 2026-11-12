import { createHash, randomBytes } from 'node:crypto';

/** 32 bytes = 256 bits of randomness, URL-safe. Used for refresh, reset and invite tokens. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** We store only hashes of tokens, never the tokens themselves. */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
