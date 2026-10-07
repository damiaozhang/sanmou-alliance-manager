export function DetailRow(props: { label: string; items: string[] }): JSX.Element {
  const visibleItems = props.items.map((i) => i.trim()).filter(Boolean);
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-[44px_minmax(0,1fr)]">
      <span className="pt-1 text-muted-foreground">{props.label}</span>
      {visibleItems.length === 0 ? (
        <span className="rounded-md border border-border px-2 py-1 text-muted-foreground">-</span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {visibleItems.map((item, i) => (
            <span
              key={`${props.label}:${item}:${i}`}
              className="max-w-full rounded-md border border-border bg-card px-2 py-1 text-foreground/80"
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
