import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface KpiItem {
  label: string;
  value: number;
  suffix?: string;
  /** 无数据时直接显示（如 "—"），跳过 count-up（规格 §4：无数据不显示 0） */
  overrideText?: string;
  delta?: { text: string; tone: "up" | "down" | "flat" };
}

const deltaTone: Record<NonNullable<KpiItem["delta"]>["tone"], string> = {
  up: "text-victory",
  down: "text-defeat",
  flat: "text-muted-foreground/70",
};

function useCountUp(target: number, duration = 700) {
  const [n, setN] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min((t - t0) / duration, 1);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return n;
}

function KpiCell({ item }: { item: KpiItem }) {
  const n = useCountUp(item.value);
  return (
    <div className="border-r border-[var(--hair)] px-4 py-3.5 last:border-r-0">
      <div className="text-[11px] tracking-[0.08em] text-muted-foreground/70">{item.label}</div>
      <div className="mt-1 text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums">
        {item.overrideText ?? `${n}${item.suffix ?? ""}`}
      </div>
      {item.delta ? (
        <div className={cn("mt-1 text-[11.5px] tabular-nums", deltaTone[item.delta.tone])}>
          {item.delta.text}
        </div>
      ) : null}
    </div>
  );
}

export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <div
      className="surface-card mb-4 grid overflow-hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <KpiCell key={item.label} item={item} />
      ))}
    </div>
  );
}
