import { useCallback, useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "@/lib/runtime";
import { cn } from "@/lib/utils";

/** Windows desktop chrome. Browser preview keeps the normal browser frame. */
export function DesktopTitleBar() {
  const [maximized, setMaximized] = useState(false);
  const desktop = isTauriRuntime();

  const refreshMaximized = useCallback(async () => {
    if (!desktop) return;
    try {
      setMaximized(await getCurrentWindow().isMaximized());
    } catch (err) {
      console.error("[DesktopTitleBar] 读取最大化状态失败", err);
    }
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    void refreshMaximized();
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void appWindow
      .onResized(() => void refreshMaximized())
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [desktop, refreshMaximized]);

  if (!desktop) return null;

  // 静默吞掉 Promise 会让权限缺失类故障表现为「点了完全没反应」，极难排查。
  // 这里统一捕获并打日志，同时把非权限的原生窗口操作失败暴露出来。
  const run = (action: () => Promise<void>) => {
    action().catch((err) => {
      console.error("[DesktopTitleBar] 窗口操作失败（检查 capabilities 中 core:window:* 权限）", err);
    });
  };

  // Tauri v2 不再内置处理 data-tauri-drag-region（那是 v1 的行为），仅加属性窗口拖不动，
  // 必须手动调 startDragging。双击切换最大化则完全由自己实现。
  const onDragPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    run(async () => {
      const win = getCurrentWindow();
      if (e.detail === 2) {
        await win.toggleMaximize();
        await refreshMaximized();
        return;
      }
      await win.startDragging();
    });
  };

  return (
    <div className="flex h-8 shrink-0 select-none items-center border-b border-white/[0.07] bg-nav-bg text-nav-fg">
      <div
        onPointerDown={onDragPointerDown}
        className="flex h-full min-w-0 flex-1 cursor-default items-center px-3"
      >
        <span className="text-[11.5px] font-medium text-nav-fg-active">三谋同盟管理助手</span>
        <span className="ml-2 text-[10.5px] text-nav-fg-muted">同盟作战情报台</span>
      </div>
      <div className="flex h-full" aria-label="窗口控制">
        <WindowButton label="最小化" onClick={() => run(() => getCurrentWindow().minimize())}>
          <Minus size={14} />
        </WindowButton>
        <WindowButton
          label={maximized ? "还原" : "最大化"}
          onClick={() =>
            run(async () => {
              await getCurrentWindow().toggleMaximize();
              await refreshMaximized();
            })
          }
        >
          <Square size={11} />
        </WindowButton>
        <WindowButton label="关闭" destructive onClick={() => run(() => getCurrentWindow().close())}>
          <X size={14} />
        </WindowButton>
      </div>
    </div>
  );
}

function WindowButton({
  children,
  label,
  destructive = false,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-full w-11 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-nav-indicator",
        destructive
          ? "hover:bg-destructive hover:text-destructive-foreground"
          : "hover:bg-white/[0.09] hover:text-nav-fg-active",
      )}
    >
      {children}
    </button>
  );
}
