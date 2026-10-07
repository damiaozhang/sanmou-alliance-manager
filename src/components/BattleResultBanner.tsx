/**
 * V7 战果横幅：结构化战报顶部的胜/负大标语。
 * - 胜方为攻击方 → 胜利绿调（victory）
 * - 胜方为防守方 → 败北红调（defeat）
 * - 无法判定 → 平局琥珀调（draw）
 * 纯展示组件，无状态。
 */
import React from "react";
import { cn } from "@/lib/utils";
import type { BattleDetails } from "@/battle-grabber/types";

export function BattleResultBanner({ details }: { details: BattleDetails }): JSX.Element {
  const attackerWon = Boolean(details.attacker?.winner);
  const defenderWon = Boolean(details.defender?.winner);
  const isDraw = attackerWon === defenderWon;

  const tone = isDraw
    ? { label: "平局", bar: "bg-draw", text: "text-draw", chip: "border-draw/40 bg-draw/10" }
    : attackerWon
      ? { label: "胜利", bar: "bg-victory", text: "text-victory", chip: "border-victory/40 bg-victory/10" }
      : { label: "败北", bar: "bg-defeat", text: "text-defeat", chip: "border-defeat/40 bg-defeat/10" };

  const attackerName = details.attacker?.player.name || "攻方";
  const defenderName = details.defender?.player.name || "守方";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border px-4 py-3",
        tone.chip
      )}
    >
      {/* 顶部 3px 色条 */}
      <div className={cn("absolute inset-x-0 top-0 h-0.5", tone.bar)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className={cn("text-base font-bold", tone.text)}>{tone.label}</span>
          <span className="text-muted-foreground">
            {attackerName}
            <span className="mx-1.5 text-muted-foreground/70">VS</span>
            {defenderName}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-caption text-muted-foreground">
          <span className="rounded-md border border-border bg-card/80 px-2 py-0.5">
            {details.source || "结构化战报"}
          </span>
        </div>
      </div>
    </div>
  );
}
