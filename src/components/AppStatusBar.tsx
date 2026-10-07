import { Activity, Command, Database } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppStatusBar({
  workspaceName,
  scanningActive,
  hasFailedCapture,
}: {
  workspaceName?: string;
  scanningActive: boolean;
  hasFailedCapture?: boolean;
}) {
  const status = scanningActive
    ? { label: "正在采集", tone: "text-info", dot: "bg-info" }
    : hasFailedCapture
      ? { label: "存在失败任务", tone: "text-defeat", dot: "bg-defeat" }
      : { label: "数据服务就绪", tone: "text-victory", dot: "bg-victory" };

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-card px-3 text-[10.5px] text-muted-foreground">
      <span className={cn("flex items-center gap-1.5", status.tone)} aria-live="polite">
        <span className={cn("size-1.5 rounded-full", status.dot, scanningActive && "status-pulse")} />
        {status.label}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <Database size={11} />
        <span className="truncate">{workspaceName || "未选择工作区"}</span>
      </span>
      <span className="ml-auto hidden items-center gap-1.5 md:flex">
        <Activity size={11} />
        本地数据库
      </span>
      <span className="hidden items-center gap-1.5 lg:flex">
        <Command size={11} />
        Ctrl K 跳转 · Ctrl B 侧栏
      </span>
    </footer>
  );
}
