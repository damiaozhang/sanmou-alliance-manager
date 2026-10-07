import type { JsonRecord } from "../types";

// 以下三个工具函数已统一到 @/lib/* 共享层，此处仅做 re-export 保持现有导入路径兼容
export { csvCell, downloadTextFile } from "@/lib/csv";
export { formatFileTimestamp } from "@/lib/format";

export function asRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

export function asBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

export function appendLimited<T>(items: T[], next: T, max: number): T[] {
  const merged = [...items, next];
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

export function appendLimitedMany<T>(items: T[], nextItems: T[], max: number): T[] {
  if (nextItems.length === 0) {
    return items;
  }
  const merged = [...items, ...nextItems];
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

export function getObjectField(record: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

export function getNumericField(record: JsonRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}
