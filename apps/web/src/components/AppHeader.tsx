import { Link } from 'react-router';
import { useMe } from '@/features/auth/useMe';
import { UserAvatar } from './UserAvatar';

/** Minimal top bar for now. Day 7 replaces it with the workspace layout (switcher, bell, menu). */
export function AppHeader() {
  const { data } = useMe();
  return (
    <header className="flex h-14 items-center justify-between border-b px-4">
      <Link to="/workspaces" className="font-bold tracking-tight">
        TeamBoard
      </Link>
      {data && (
        <Link to="/profile" aria-label="Your profile" className="rounded-full">
          <UserAvatar name={data.user.name} color={data.user.avatarColor} className="size-8" />
        </Link>
      )}
    </header>
  );
}
