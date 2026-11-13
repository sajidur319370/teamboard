import { Types } from 'mongoose';
import { badRequest } from './errors';

type Keyed = { createdAt: Date; _id: Types.ObjectId };

/**
 * Keyset pagination on (createdAt, _id) (queries.md §11). `_id` breaks ties: two rows can
 * share a millisecond (a move + its completion share ctx.now()), and without it a page
 * boundary between them would skip or repeat one. Opaque to clients: base64url JSON.
 */
export const encodeCursor = (d: Keyed) =>
  Buffer.from(JSON.stringify({ t: d.createdAt.toISOString(), id: String(d._id) })).toString(
    'base64url',
  );

export function decodeCursor(cursor: string): { t: Date; id: Types.ObjectId } {
  try {
    const { t, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      t: unknown;
      id: unknown;
    };
    const date = typeof t === 'string' ? new Date(t) : new Date(NaN);
    if (Number.isNaN(date.getTime()) || typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) {
      throw new Error('bad cursor');
    }
    return { t: date, id: new Types.ObjectId(id) };
  } catch {
    throw badRequest('INVALID_CURSOR', 'Invalid cursor.');
  }
}

/** The filter for "strictly after the cursor" in the given sort direction. */
export function afterCursor(cursor: string, dir: 'asc' | 'desc') {
  const { t, id } = decodeCursor(cursor);
  const op = dir === 'asc' ? '$gt' : '$lt';
  return { $or: [{ createdAt: { [op]: t } }, { createdAt: t, _id: { [op]: id } }] };
}

/** Callers fetch limit + 1 rows: the extra one only says "there is another page". */
export function pageOf<T extends Keyed>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}
