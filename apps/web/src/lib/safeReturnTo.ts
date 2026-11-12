/**
 * Only same-site relative paths are allowed as a post-login destination (prevents open redirects).
 * Rejects `//evil.com` and `/\evil.com`, which browsers treat as protocol-relative URLs.
 */
export function safeReturnTo(value: string | null | undefined, fallback = '/workspaces'): string {
  if (!value || !value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
