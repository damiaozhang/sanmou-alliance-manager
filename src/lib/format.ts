// 通用格式化工具函数
// 供主应用和战报提取器子应用共享，消除重复实现

export function formatErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage;
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}

export function formatWanNumber(value?: number | null): string {
  if (!value) return "-";
  if (value >= 10000) {
    const text = (value / 10000).toFixed(1).replace(/\.0$/, "");
    return `${text}万`;
  }
  return `${value}`;
}

export function formatFileTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// ── 阶段4 自 helpers.ts 并入的通用格式化 ──

export function formatDeltaNumber(current: number, previous: number, suffix = "") {
  const delta = current - previous;
  return `${delta >= 0 ? "+" : ""}${delta}${suffix}`;
}

export function parseLevelNumber(value: string) {
  const match = value.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : 0;
}

export function cleanGameDisplayText(value?: string | null) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/[【】]/g, "")
    .trim();
}

export function formatAllianceCargoRatio(merit: number, cargo: number) {
  if (!cargo) return "-";
  const ratio = merit / cargo;
  if (!Number.isFinite(ratio)) return "-";
  return ratio.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export const previewOrEmpty = <T>(rows: T[] | undefined) => {
  if (rows && rows.length > 0) {
    return rows.slice();
  }
  return [];
};
