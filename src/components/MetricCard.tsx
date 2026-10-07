import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

type MetricTone = "default" | "primary" | "victory" | "defeat" | "info" | "muted";

type MetricCardProps = {
  label: string;
  value: React.ReactNode;
  /** 口径说明（阶段4 口径定稿）：小字展示并同时作为 title tooltip */
  hint?: string;
  /** default 不着色；primary 对应旧 accent 的边框/底色强调；victory/defeat/info/muted 仅 value 着色 */
  tone?: MetricTone;
  /** compact 复刻原 MiniStat 密集网格视觉（裸 div 小字），不用 Card 底座 */
  size?: "default" | "compact";
  interactive?: boolean;
  onClick?: () => void;
  className?: string;
};

const valueToneClass: Record<MetricTone, string> = {
  default: "",
  primary: "text-primary",
  victory: "text-victory",
  defeat: "text-defeat",
  info: "text-info",
  muted: "text-muted-foreground"
};

export function MetricCard({ label, value, hint, tone = "default", size = "default", interactive = false, onClick, className }: MetricCardProps) {
  if (size === "compact") {
    return (
      <div
        className={cn(
          "rounded-md border border-border bg-card/80 px-3 py-2",
          interactive && "cursor-pointer",
          className
        )}
        onClick={onClick}
        title={hint}
      >
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("mt-1 truncate text-sm font-medium", valueToneClass[tone])}>{value}</p>
        {hint && <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{hint}</p>}
      </div>
    );
  }
  return (
    <Card
      className={cn(
        "transition-all duration-150",
        tone === "primary" && "border-primary/20 bg-primary/5",
        interactive && "cursor-pointer hover:shadow-md hover:border-primary/30",
        className
      )}
      onClick={onClick}
      title={hint}
    >
      <CardContent className="px-4 py-3">
        <p className="text-caption font-medium text-muted-foreground">{label}</p>
        <p className={cn(
          "mt-0.5 text-metric font-bold tracking-tight tabular-nums",
          valueToneClass[tone]
        )}>
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
