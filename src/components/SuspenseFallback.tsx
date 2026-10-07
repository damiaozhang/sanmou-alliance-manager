export function SuspenseFallback({ variant = "page", rows = 5 }) {
  if (variant === "table") {
    return (
      <div className="space-y-2 p-6">
        <div className="skeleton h-8 w-48" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton h-10 w-full" style={{ opacity: 0.6 - i * 0.08 }} />
        ))}
      </div>
    );
  }
  if (variant === "card") {
    return (
      <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-24 rounded-lg" style={{ opacity: 0.7 - i * 0.1 }} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="space-y-4 w-full max-w-md">
        <div className="skeleton h-8 w-3/4" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-32 w-full mt-4" />
      </div>
    </div>
  );
}
