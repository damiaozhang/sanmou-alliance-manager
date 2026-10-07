/**
 * 术语与展示映射的公共落点。
 * 本任务（S1-4b）先收口 resultBadge 胜负平 → Badge variant 映射；
 * S2 术语统一也会基于本文件扩展；阶段4 并入采集会话标签/摘要工具（原 helpers.ts）。
 */

import type { CaptureSessionRow } from "../tauri";
import { formatCaptureRecordId } from "./dates";

export type BattleResultLabel = "胜" | "负" | "平" | "未知";
export type ResultBadgeVariant = "default" | "destructive" | "secondary" | "success";
export type BattleSideOutcome = "win" | "loss" | "draw" | "unknown";

/**
 * 以攻击方为基准解释战报结果字符串。
 * 协议中的 result 是攻守视角（攻方胜/守方胜/平局），不是“我方视角”：
 * 守方胜 = 攻击方负，用于时间线等按攻击方阵容展示的场景。
 */
export function attackerOutcomeFromResult(result: string): BattleSideOutcome {
  const r = result.toLowerCase();
  if (r.includes("守方胜") || r.includes("defender_win") || r.includes("defend_win")) {
    return "loss";
  }
  if (r.includes("攻方胜") || r.includes("attacker_win") || r.includes("attack_win")) {
    return "win";
  }
  if (r.includes("平") || r.includes("draw")) {
    return "draw";
  }
  if (r.includes("胜") || r.includes("win")) {
    return "win";
  }
  if (r.includes("负") || r.includes("败") || r.includes("loss")) {
    return "loss";
  }
  return "unknown";
}

/** 战报结果字符串 → { 胜负平标签, Badge variant }（原 BattleTimelinePage 文件内 resultBadge） */
export function resultBadge(result: string): { label: BattleResultLabel; variant: ResultBadgeVariant } {
  const outcome = attackerOutcomeFromResult(result);
  if (outcome === "win") return { label: "胜", variant: "success" };
  if (outcome === "loss") return { label: "负", variant: "destructive" };
  if (outcome === "draw") return { label: "平", variant: "secondary" };
  // P2-3 修复：unknown（无法判定的战报）不再被当作"平"——平局是明确的
  // winnerSide=draw 结果，unknown 应单独归类为"未知"，避免稀释胜负统计。
  return { label: "未知", variant: "secondary" };
}

/** 已知胜负平标签 → Badge variant（用于结果不由字符串解析得来的场景） */
export function resultBadgeVariant(label: BattleResultLabel): ResultBadgeVariant {
  if (label === "胜") return "success";
  if (label === "负") return "destructive";
  return "secondary";
}

/** 采集类型 → UI 展示文案（S2-1 收编单一源：原 helpers.ts 旧实现、自动采集页本地实现与 SelectItem 内联拷贝） */
export function captureTypeLabel(value?: string | null): string {
  if (value === "alliance_data") return "同盟采集";
  if (value === "battle_passive") return "战报采集";
  if (value === "seed_demo" || value === "seed_demo_history") return "示例数据";
  return value && value.trim() ? value : "-";
}

export type CaptureStatusBadgeVariant = "success" | "info" | "destructive" | "secondary";

/** 采集会话状态 → { 标签, Badge variant }（S3-2 采集中心会话历史表/运行卡单一源） */
export function captureStatusBadge(status: string): { label: string; variant: CaptureStatusBadgeVariant } {
  if (status === "completed") return { label: "已完成", variant: "success" };
  if (status === "running") return { label: "运行中", variant: "info" };
  if (status === "failed") return { label: "失败", variant: "destructive" };
  if (status === "stopped") return { label: "已停止", variant: "secondary" };
  return { label: status && status.trim() ? status : "-", variant: "secondary" };
}

/** 同盟数据采集中空态文案（S2-1 收编：原 AllianceDataPage / MembersTab / CargoTab 三份逐字拷贝） */
export const ALLIANCE_SCANNING_EMPTY = "同盟数据正在采集中，等本次采集结束后会自动更新。";

/** 工作区创建表单字段标签（S3-1 总览创建引导卡；术语单一源，硬编码业务文案属基调反模式 #8） */
export const WORKSPACE_FORM_LABELS = {
  name: "工作区名称",
  serverName: "服务器名称",
  seasonName: "赛季",
  allianceName: "同盟名称",
  allianceGameId: "同盟 ID"
} as const;

// ── 采集会话标签/摘要（阶段4 自 helpers.ts 并入，勿在他处重复定义） ──

export function sortedCaptureSessions(rows: CaptureSessionRow[] | undefined) {
  return [...(rows ?? [])].sort(
    (left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
  );
}

export function captureRecordLabel(session: CaptureSessionRow) {
  return `采集记录 ${formatCaptureRecordId(session.startedAt)}`;
}

export function summarizeSessionNote(session: CaptureSessionRow) {
  const typed = session.summary;
  if (!typed) return "-";
  try {
    const capture = typed.capture;
    const artifacts = capture.expectedArtifacts?.length ?? 0;
    const runtime = capture.runtime as Record<string, unknown> | null | undefined;
    const runtimeRecordCount =
      runtime && typeof runtime.recordCount === "number" ? runtime.recordCount : null;
    const previewSource: Record<string, unknown> = typed.previewInsertCounts ?? capture.preview ?? {};
    const previewCountMap: Array<{ keys: string[]; label: string }> = [
      { keys: ["memberSnapshots"], label: "成员" },
      { keys: ["legionGroups"], label: "分组" },
      { keys: ["unionLogs", "unionLogEvents"], label: "日志" },
      { keys: ["buildingSnapshots"], label: "设施" },
      { keys: ["battleBlocks"], label: "战报" },
      { keys: ["lineupProfiles"], label: "阵容" }
    ];
    const previewCounts = previewCountMap
      .map(({ keys, label }) => {
        const matchedKey = keys.find((key: string) => key in previewSource);
        if (!matchedKey) return "";
        const value = previewSource[matchedKey];
        const count = Array.isArray(value) ? value.length : typeof value === "number" ? value : 0;
        return count ? `${label}${count}` : "";
      })
      .filter(Boolean);
    const pieces = [
      captureTypeLabel(capture.captureType),
      artifacts ? `${artifacts}个文件` : "",
      runtimeRecordCount !== null ? `${runtimeRecordCount}条记录` : "",
      ...previewCounts
    ].filter(Boolean);
    return pieces.join(" · ") || "暂无摘要";
  } catch {
    return "-";
  }
}

/** 采集会话 runtime dump 的记录数；缺失/非法视为 0（单次采集会话选择用）。 */
export function sessionRuntimeRecordCount(session: CaptureSessionRow): number {
  const runtime = session.summary?.capture?.runtime;
  if (!runtime || typeof runtime !== "object") return 0;
  const recordCount = (runtime as Record<string, unknown>).recordCount;
  return typeof recordCount === "number" && Number.isFinite(recordCount) ? recordCount : 0;
}

// ── 按会话过滤行的小工具（同属采集会话域） ──

export function rowsForCaptureSession<T extends object>(rows: T[], sessionId: number | null) {
  const sessionOf = (row: T) => (row as { captureSessionId?: number }).captureSessionId;
  if (sessionId === null || rows.every((row) => sessionOf(row) === undefined)) {
    return rows;
  }
  return rows.filter((row) => sessionOf(row) === sessionId);
}

export function newestCaptureSessionId<T extends object>(rows: T[]) {
  return rows.reduce<number | null>((latest, row) => {
    const sessionId = (row as { captureSessionId?: number }).captureSessionId;
    if (typeof sessionId !== "number") {
      return latest;
    }
    return latest === null || sessionId > latest ? sessionId : latest;
  }, null);
}

export function preferredCaptureSessionId<T extends object>(rows: T[], preferredSessionId: number | null) {
  if (
    preferredSessionId !== null &&
    rows.some((row) => (row as { captureSessionId?: number }).captureSessionId === preferredSessionId)
  ) {
    return preferredSessionId;
  }
  return newestCaptureSessionId(rows);
}
