import { cn } from "@/lib/utils";

interface LiveSessionCardProps {
  active: boolean;
  version: string;
  fetched: number;
  target: number;
  elapsedLabel: string;
}

export function LiveSessionCard({ active, version, fetched, target, elapsedLabel }: LiveSessionCardProps) {
  const pct = target > 0 ? Math.min(Math.round((fetched / target) * 100), 100) : 0;
  return (
    <div className="surface-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">当前采集会话</h3>
        <span className="ml-auto text-[11px] text-muted-foreground/70">同盟快照</span>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "size-[9px] shrink-0 rounded-full",
            active ? "status-pulse bg-victory" : "bg-muted-foreground/40",
          )}
        />
        <div className="text-[12px] leading-snug text-muted-foreground">
          {active ? "采集中" : "未采集"} · <b className="font-semibold text-foreground">sidecar v{version}</b>
          {active ? " 在线" : ""}
          <br />
          已抓取 <b className="font-semibold tabular-nums text-foreground">{fetched}</b> / 目标{" "}
          <b className="font-semibold tabular-nums text-foreground">{target}</b> 条
        </div>
        <div className="ml-auto text-[22px] font-bold tabular-nums tracking-[-0.01em] text-primary">
          {elapsedLabel}
        </div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
