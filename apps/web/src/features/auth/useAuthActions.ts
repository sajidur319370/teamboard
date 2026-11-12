import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { AuthResponse, LoginInput, MeResponse, RegisterInput } from '@teamboard/shared';
import { http, setAccessToken } from '@/api/client';
import { qk } from '@/api/keys';

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
