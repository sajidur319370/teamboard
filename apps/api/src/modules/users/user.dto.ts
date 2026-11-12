import type { Types } from 'mongoose';
import type { UserDto } from '@teamboard/shared';

type UserLike = {
  _id: Types.ObjectId;
  email: string;
  name: string;
  avatarColor?: string | null;
  timezone?: string | null;
};

/** The only way a user leaves the API. Never send the raw document (it may carry passwordHash). */
export function toUserDto(u: UserLike): UserDto {
  return {
    id: String(u._id),
    email: u.email,
    name: u.name,
    avatarColor: u.avatarColor ?? 'blue',
    timezone: u.timezone ?? 'UTC',
  };
}
