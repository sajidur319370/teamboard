/** Placeholder for workspace pages that arrive on later build days. */
export function ComingSoon({ title, day }: { title: string; day: number }) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming on Day {day}.</p>
    </div>
  );
}
