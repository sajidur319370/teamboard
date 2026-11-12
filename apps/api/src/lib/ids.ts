import { Types } from 'mongoose';

/** Use only on strings that were already validated as ObjectIds (objectIdSchema). */
export const oid = (id: string | Types.ObjectId) =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

/** E11000 on a specific index, e.g. isDuplicateKey(err, 'uniq_member'). */
export function isDuplicateKey(err: unknown, indexName: string): boolean {
  const e = err as { code?: number; message?: string };
  return e?.code === 11000 && (e.message ?? '').includes(`index: ${indexName} `);
}
