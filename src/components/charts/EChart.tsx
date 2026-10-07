import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { cn } from "@/lib/utils";

echarts.use([AriaComponent, BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export function EChart({
  option,
  className,
  ariaLabel,
}: {
  option: EChartsOption;
  className?: string;
  ariaLabel: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const chart = echarts.init(hostRef.current, undefined, { renderer: "canvas" });
    chart.setOption(option, { notMerge: true });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(hostRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [option]);

  return <div ref={hostRef} className={cn("h-[190px] w-full", className)} role="img" aria-label={ariaLabel} />;
}
