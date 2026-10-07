import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { BattleReportRow } from "../../tauri";
import { localDateKey } from "@/lib/dates";
import { attackerOutcomeFromResult } from "@/lib/labels";
import { aggregateDailyWinRate, type WinRateOutcome } from "@/lib/winrate";
import { EChart } from "./EChart";

interface Props {
  battles: BattleReportRow[];
  days?: number;
}

function useThemeRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setRevision((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return revision;
}

function token(name: string, _themeRevision?: number) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `hsl(${value})`;
}

export function BattleWinRateChart({ battles, days = 7 }: Props) {
  const themeRevision = useThemeRevision();
  const { daily, winRate, option } = useMemo(() => {
    const { daily } = aggregateDailyWinRate<BattleReportRow>(
      battles,
      (battle) => localDateKey(new Date(battle.time)),
      (battle) => attackerOutcomeFromResult(battle.result) as WinRateOutcome,
      days,
    );
    const total = daily.reduce((sum, day) => sum + day.total, 0);
    const weightedWins = daily.reduce((sum, day) => sum + day.wins + day.draws * 0.5, 0);
    const winRate = total > 0 ? Math.round((weightedWins / total) * 100) : 0;
    const foreground = token("--foreground", themeRevision);
    const muted = token("--muted-foreground");
    const border = token("--border");
    const victory = token("--victory");
    const defeat = token("--defeat");
    const draw = token("--draw");
    const info = token("--info");

    const option: EChartsOption = {
      animationDuration: 320,
      animationDurationUpdate: 220,
      aria: { enabled: false },
      color: [victory, draw, defeat, info],
      grid: { left: 6, right: 6, top: 30, bottom: 0, containLabel: true },
      legend: {
        top: 0,
        right: 0,
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: muted, fontSize: 11 },
        data: ["胜", "平", "负", "胜率"],
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: token("--popover"),
        borderColor: border,
        textStyle: { color: foreground, fontSize: 12 },
        extraCssText: "box-shadow: 0 10px 28px rgba(0,0,0,.14); border-radius: 6px;",
      },
      xAxis: {
        type: "category",
        data: daily.map((day) => day.date.slice(5)),
        axisLine: { lineStyle: { color: border } },
        axisTick: { show: false },
        axisLabel: { color: muted, fontSize: 10.5, margin: 9 },
      },
      yAxis: [
        {
          type: "value",
          minInterval: 1,
          splitNumber: 3,
          axisLabel: { color: muted, fontSize: 10 },
          splitLine: { lineStyle: { color: border, type: "dashed" } },
        },
        { type: "value", min: 0, max: 100, show: false },
      ],
      series: [
        { name: "胜", type: "bar", stack: "battle", barMaxWidth: 22, data: daily.map((day) => day.wins) },
        { name: "平", type: "bar", stack: "battle", barMaxWidth: 22, data: daily.map((day) => day.draws) },
        { name: "负", type: "bar", stack: "battle", barMaxWidth: 22, data: daily.map((day) => day.losses) },
        {
          name: "胜率",
          type: "line",
          yAxisIndex: 1,
          smooth: 0.28,
          symbolSize: 6,
          lineStyle: { width: 2.5 },
          data: daily.map((day) => Math.round(day.winRate * 100)),
        },
      ],
    };
    return { daily, winRate, option };
  }, [battles, days, themeRevision]);

  const totalBattles = daily.reduce((sum, day) => sum + day.total, 0);

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[26px] font-medium leading-none tabular-nums">{winRate}%</span>
        <span className="text-[11.5px] text-muted-foreground">{totalBattles} 场 · 平局计半胜</span>
      </div>
      <EChart option={option} ariaLabel={`近 ${days} 天战况图，合计 ${totalBattles} 场，胜率 ${winRate}%`} />
    </div>
  );
}
