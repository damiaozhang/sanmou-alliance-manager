// 时间对比窗口逻辑（阶段4 自 helpers.ts 拆出）
// 阶段3b：大表（成员/设施/战报快照）不再随 bundle 下发，对比窗口仅由采集会话时间线推导；
// ComparisonPage 的各域对比数据改由各自分片命令（get_comparison_stats / 分片查询）供数

import type { CaptureSessionRow } from "@/tauri";
import { dateKey } from "@/lib/dates";

export type ComparisonWindow = {
  from: string;
  to: string;
};

export function inWindow(value: string, window: ComparisonWindow) {
  const key = dateKey(value);
  return (!window.from || key >= window.from) && (!window.to || key <= window.to);
}

export function deriveComparisonWindows(sessions: CaptureSessionRow[]) {
  const dates = new Set<string>();
  sessions.forEach((r) => { const k = dateKey(r.startedAt); if (k) dates.add(k); });
  const ordered = [...dates].sort();
  if (ordered.length === 0) return { current: { from: "", to: "" }, previous: { from: "", to: "" } };
  const cur = ordered[ordered.length - 1];
  const prev = ordered[ordered.length - 2] ?? cur;
  return { current: { from: cur, to: cur }, previous: { from: prev, to: prev } };
}

export function latestByKey<T>(
  rows: T[],
  keyFn: (row: T) => string,
  dateFn: (row: T) => string,
  window: ComparisonWindow
) {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (!inWindow(dateFn(row), window)) continue;
    const key = keyFn(row);
    const existing = latest.get(key);
    // 比较日期保留最新行；仅在无现有行或当前行日期更晚时覆盖
    if (!existing || dateFn(row) > dateFn(existing)) {
      latest.set(key, row);
    }
  }
  return [...latest.values()];
}
