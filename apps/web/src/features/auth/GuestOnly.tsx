import { Navigate, Outlet, useSearchParams } from 'react-router';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { safeReturnTo } from '@/lib/safeReturnTo';
import { useMe } from './useMe';

/** Wraps /login and /register: an already logged-in user is sent on to returnTo. */
export function GuestOnly() {
  const me = useMe();
  const [params] = useSearchParams();

  if (me.isPending) return <FullPageSpinner />;
  if (me.data) return <Navigate to={safeReturnTo(params.get('returnTo'))} replace />;
  return <Outlet />;
}
