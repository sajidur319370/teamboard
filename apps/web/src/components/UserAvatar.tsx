import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { avatarBg, initials } from '@/lib/colors';
import { cn } from '@/lib/utils';

/** Initials on the user's chosen color (no image uploads in v1). */
export function UserAvatar(props: { name: string; color: string; className?: string }) {
  return (
    <Avatar className={props.className} title={props.name}>
      <AvatarFallback className={cn('font-medium text-white', avatarBg(props.color))}>
        {initials(props.name)}
      </AvatarFallback>
    </Avatar>
  );
}
