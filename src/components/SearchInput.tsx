import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * 受控搜索输入框：左侧 Search 图标，有值时右侧显示清除按钮。
 * （图标与清除按钮是 S1-4b 有意新增的可用性能力。）
 */
export function SearchInput({ value, onChange, placeholder, className }: SearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-8"
      />
      {value ? (
        <button
          type="button"
          aria-label="清除搜索"
          className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          onClick={() => onChange("")}
        >
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}
