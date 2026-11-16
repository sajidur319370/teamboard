import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type {
  AuthResponse,
  DemoInfo,
  DemoRole,
  LoginInput,
  MeResponse,
  RegisterInput,
} from '@teamboard/shared';
import { http, setAccessToken } from '@/api/client';
import { qk } from '@/api/keys';
import { disconnectSocket } from '@/socket/client';

/** Shared by login and register: store the token, load /me into the cache, go to returnTo. */
function useOnSignedIn(returnTo: string) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async ({ accessToken }: AuthResponse) => {
    setAccessToken(accessToken);
    qc.setQueryData(qk.me, await http.get<MeResponse>('/me'));
    navigate(returnTo, { replace: true });
  };
}

export function useLogin(returnTo: string) {
  const onSuccess = useOnSignedIn(returnTo);
  return useMutation({
    mutationFn: (v: LoginInput) => http.post<AuthResponse>('/auth/login', v),
    onSuccess,
  });
}

/** Is this a public demo (DEMO_MODE on the server)? The login page shows role buttons. */
export const useDemoInfo = () =>
  useQuery({
    queryKey: ['demo-info'],
    queryFn: () => http.get<DemoInfo>('/auth/demo'),
    staleTime: Infinity,
    retry: false, // no demo info = no buttons, never an error on the login page
  });

/** One click: log in as a demo role (no password typed). */
export function useDemoLogin(returnTo: string) {
  const onSuccess = useOnSignedIn(returnTo);
  return useMutation({
    mutationFn: (role: DemoRole) => http.post<AuthResponse>('/auth/demo', { role }),
    onSuccess,
  });
}

export function useRegister(returnTo: string) {
  const onSuccess = useOnSignedIn(returnTo);
  return useMutation({
    mutationFn: (v: RegisterInput) => http.post<AuthResponse>('/auth/register', v),
    onSuccess,
  });
}

/** Forget everything about the session locally (token + every cached query). */
export function useClearSession() {
  const qc = useQueryClient();
  return () => {
    setAccessToken(null);
    disconnectSocket(); // the next user connects with their own token
    qc.clear(); // drop every cached query of the previous user
    qc.setQueryData(qk.me, null);
  };
}

/**
 * @param all       log out of every device (POST /auth/logout-all)
 * @param redirectTo where to go afterwards, e.g. `/login?returnTo=/invite/abc` (E15)
 */
export function useLogout({ all = false, redirectTo = '/login' } = {}) {
  const clearSession = useClearSession();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => http.post<void>(all ? '/auth/logout-all' : '/auth/logout'),
    // Even if the request fails (offline), the user asked to leave: clear local state.
    onSettled: () => {
      clearSession();
      navigate(redirectTo, { replace: true });
    },
  });
}
