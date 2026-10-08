import type { ReactNode } from "react";
import { Search } from "lucide-react";

interface AppTopBarProps {
  viewTitle: string;
  workspaceName?: string;
  onOpenPalette: () => void;
  shortcutLabel: string;
  /** 右侧插槽：工作区切换器等，置于搜索胶囊左侧 */
  workspaceSwitcher?: ReactNode;
}

export function AppTopBar({
  viewTitle,
  workspaceName,
  onOpenPalette,
  shortcutLabel,
  workspaceSwitcher,
}: AppTopBarProps) {
  return (
    <header className="flex h-10 min-w-0 flex-1 shrink-0 items-center gap-3 border-b border-[var(--hair)] bg-surface-0/70 px-4">
      <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <span>三谋盟管家</span>
        <span className="text-muted-foreground/40">·</span>
        {workspaceName ? <span className="max-w-[140px] truncate">{workspaceName}</span> : null}
        {workspaceName ? <span className="text-muted-foreground/40">·</span> : null}
        <b className="truncate font-semibold text-foreground">{viewTitle}</b>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {workspaceSwitcher}
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="搜索或跳转页面"
          className="flex h-[26px] items-center gap-2 rounded-lg border border-[var(--hair)] bg-surface-1 px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-[var(--hair-strong)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search size={13} />
          <span>搜索成员 / 战报 / 阵容</span>
          <kbd className="rounded border border-[var(--hair-strong)] px-1 text-[10px]">{shortcutLabel}</kbd>
        </button>
      </div>
    </header>
  );
}
