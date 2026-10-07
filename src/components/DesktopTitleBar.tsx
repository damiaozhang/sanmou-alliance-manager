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
    setMaximized(await getCurrentWindow().isMaximized());
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

  const run = (action: () => Promise<void>) => {
    void action();
  };

  return (
    <div className="flex h-8 shrink-0 select-none items-center border-b border-white/[0.07] bg-nav-bg text-nav-fg">
      <div data-tauri-drag-region className="flex h-full min-w-0 flex-1 items-center px-3">
        <span data-tauri-drag-region className="text-[11.5px] font-medium text-nav-fg-active">
          Sanmou Ledger
        </span>
        <span data-tauri-drag-region className="ml-2 text-[10.5px] text-nav-fg-muted">
          同盟作战情报台
        </span>
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
