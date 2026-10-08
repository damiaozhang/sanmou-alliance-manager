import { useCallback, useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "@/lib/runtime";
import { cn } from "@/lib/utils";

// 静默吞掉 Promise 会让权限缺失类故障表现为「点了完全没反应」，极难排查。
// 这里统一捕获并打日志，把非权限的原生窗口操作失败暴露出来。
function run(action: () => Promise<void>) {
  action().catch((err) => {
    console.error("[WindowChrome] 窗口操作失败（检查 capabilities 中 core:window:* 权限）", err);
  });
}

/**
 * 顶栏拖拽区：Tauri v2 不再内置处理 data-tauri-drag-region，必须手动 startDragging；
 * 双击切换最大化也自己实现。返回的 onPointerDown 挂到融合顶栏容器上，
 * 命中 button 时跳过，避免与搜索胶囊/工作区切换/窗口按钮冲突。
 * 浏览器预览（非 Tauri）返回 no-op。
 */
export function useWindowDragRegion() {
  const desktop = isTauriRuntime();

  return useCallback(
    (e: React.PointerEvent) => {
      if (!desktop || e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      run(async () => {
        const win = getCurrentWindow();
        // 双击切换最大化；WindowControls 通过 onResized 同步图标，无需在此回读。
        if (e.detail === 2) await win.toggleMaximize();
        else await win.startDragging();
      });
    },
    [desktop],
  );
}

/** 跟踪窗口最大化状态，用于切换「最大化/还原」图标语义。浏览器预览恒为 false。 */
function useMaximizedState() {
  const desktop = isTauriRuntime();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    const refresh = () => {
      appWindow
        .isMaximized()
        .then(setMaximized)
        .catch((err) => console.error("[WindowChrome] 读取最大化状态失败", err));
    };
    refresh();
    void appWindow.onResized(refresh).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [desktop]);

  return maximized;
}

/**
 * Windows 桌面窗口控件（最小化/最大化/关闭）。浏览器预览返回 null，保留原生浏览器边框。
 */
export function WindowControls() {
  const desktop = isTauriRuntime();
  const maximized = useMaximizedState();

  if (!desktop) return null;

  return (
    <div className="flex h-full shrink-0 self-stretch" aria-label="窗口控制">
      <WindowButton label="最小化" onClick={() => run(() => getCurrentWindow().minimize())}>
        <Minus size={14} />
      </WindowButton>
      <WindowButton
        label={maximized ? "还原" : "最大化"}
        onClick={() =>
          run(async () => {
            await getCurrentWindow().toggleMaximize();
          })
        }
      >
        <Square size={11} />
      </WindowButton>
      <WindowButton label="关闭" destructive onClick={() => run(() => getCurrentWindow().close())}>
        <X size={14} />
      </WindowButton>
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
        "flex h-full w-11 items-center justify-center text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        destructive
          ? "hover:bg-destructive hover:text-destructive-foreground"
          : "hover:bg-surface-2 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
