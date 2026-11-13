export const addMinutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

const DAY_MS = 86_400_000;

/** Inclusive list of 'YYYY-MM-DD' days from start to end (UTC arithmetic: no DST drift). */
export function calendarDays(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** 0 = Sunday … 6 = Saturday, for a 'YYYY-MM-DD' day. */
export const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
export const round1 = (n: number) => Math.round(n * 10) / 10;
