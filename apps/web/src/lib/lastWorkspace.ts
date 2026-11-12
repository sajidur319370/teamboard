// FR-WS-03: "the last-used workspace opens after login". A per-browser convenience,
// so localStorage is fine; every access is wrapped because storage can be blocked.
const KEY = 'teamboard:lastWorkspace';

export function rememberWorkspace(slug: string) {
  try {
    localStorage.setItem(KEY, slug);
  } catch {
    /* private mode / blocked storage: just don't remember */
  }
}

export function lastWorkspace(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetWorkspace(slug: string) {
  try {
    if (localStorage.getItem(KEY) === slug) localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
