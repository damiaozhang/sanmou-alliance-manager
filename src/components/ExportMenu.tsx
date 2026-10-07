import { useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ExportMenuItem {
  label: string;
  onSelect: () => void | Promise<void>;
}

type ExportMenuProps = {
  items: ExportMenuItem[];
  /** 进行中禁用 trigger 并切换文案为「导出中…」 */
  busy?: boolean;
  triggerLabel?: string;
};

export function ExportMenu({ items, busy = false, triggerLabel = "导出" }: ExportMenuProps) {
  const [pending, setPending] = useState(false);
  const effectiveBusy = busy || pending;

  async function run(item: ExportMenuItem) {
    if (effectiveBusy) return;
    setPending(true);
    try {
      await item.onSelect();
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={effectiveBusy} aria-busy={effectiveBusy}>
          <Download className="mr-2 h-4 w-4" />
          {effectiveBusy ? "导出中…" : triggerLabel}
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem key={item.label} onSelect={() => void run(item)}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
