import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface DateRangeFilterProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  /** 传了才显示重置按钮 */
  onReset?: () => void;
  className?: string;
}

/** 手输文本日期范围过滤：容忍空串、不加校验（与迁移前现状一致）。 */
export function DateRangeFilter({ from, to, onFromChange, onToChange, onReset, className }: DateRangeFilterProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Input
        type="text"
        value={from}
        placeholder="开始日期 YYYY-MM-DD"
        onChange={(event) => onFromChange(event.target.value)}
        className="w-[180px]"
      />
      <Input
        type="text"
        value={to}
        placeholder="结束日期 YYYY-MM-DD"
        onChange={(event) => onToChange(event.target.value)}
        className="w-[180px]"
      />
      {onReset ? (
        <Button variant="outline" onClick={onReset}>
          重置
        </Button>
      ) : null}
    </div>
  );
}
