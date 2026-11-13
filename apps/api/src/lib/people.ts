import type { Types } from 'mongoose';
import type { PersonRef, UserRef } from '@teamboard/shared';
import { User } from '../db/models';

const FORMER = { name: 'Former user', avatarColor: 'gray' } as const;

/** Names + colours for a page of authors/actors in ONE query (no N+1). Users are global. */
export async function people(ids: (Types.ObjectId | string)[]): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids.map(String))];
  const users = unique.length
    ? await User.find({ _id: { $in: unique } })
        .select('name avatarColor')
        .lean()
    : [];
  const found = new Map(users.map((u) => [String(u._id), u]));
  return new Map(
    unique.map((id) => {
      const u = found.get(id);
      return [
        id,
        { id, name: u?.name ?? FORMER.name, avatarColor: u?.avatarColor ?? FORMER.avatarColor },
      ];
    }),
  );
}

/** A name snapshot for activity metadata (FR-ACT-04: renders after the user leaves). */
export async function userRefs(ids: (Types.ObjectId | string)[]): Promise<Map<string, UserRef>> {
  const found = await people(ids);
  return new Map([...found].map(([id, p]) => [id, { id, name: p.name }]));
}

export async function userRef(id: Types.ObjectId | string): Promise<UserRef> {
  return (await userRefs([id])).get(String(id))!;
}
