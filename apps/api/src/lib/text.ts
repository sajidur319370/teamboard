/**
 * Strip control characters except \t \n \r. Markdown is stored AS WRITTEN (it's text, not HTML);
 * the client renders it with react-markdown, which never renders raw HTML (Day 9 guide).
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export const cleanText = (s: string) => s.replace(CONTROL, '');

export const excerpt = (s: string, n = 100) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
