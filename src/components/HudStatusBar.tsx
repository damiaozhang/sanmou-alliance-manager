import { cn } from "@/lib/utils";

interface HudStatusBarProps {
  sidecarOnline: boolean;
  sidecarVersion: string;
  sessionLabel?: string;
  workspaceName?: string;
  freshness?: string;
  alertCount?: number;
  dbSize?: string;
}

export function HudStatusBar({
  sidecarOnline,
  sidecarVersion,
  sessionLabel,
  workspaceName,
  freshness,
  alertCount,
  dbSize,
}: HudStatusBarProps) {
  return (
    <footer className="flex h-[34px] shrink-0 items-center gap-5 border-t border-[var(--hair)] bg-surface-rail px-4 text-[11.5px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "size-[7px] rounded-full",
            sidecarOnline ? "status-pulse bg-victory" : "bg-muted-foreground/40",
          )}
        />
        sidecar{" "}
        <b className={cn("font-semibold", sidecarOnline ? "text-foreground" : "text-muted-foreground")}>
          {sidecarOnline ? "在线" : "离线"}
        </b>
        <span className="tabular-nums">v{sidecarVersion}</span>
      </span>
      {sessionLabel ? (
        <span>
          采集会话 <b className="font-semibold tabular-nums text-foreground">{sessionLabel}</b>
        </span>
      ) : null}
      {workspaceName ? (
        <span>
          工作区 <b className="font-semibold text-foreground">{workspaceName}</b>
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-5">
        {freshness ? (
          <span>
            数据新鲜度 <b className="font-semibold text-foreground">{freshness}</b>
          </span>
        ) : null}
        {alertCount ? (
          <span className="text-warning">
            告警 <b className="font-semibold tabular-nums text-warning">{alertCount}</b>
          </span>
        ) : null}
        {dbSize ? (
          <span>
            DB <b className="font-semibold tabular-nums text-foreground">{dbSize}</b>
          </span>
        ) : null}
      </span>
    </footer>
  );
}
