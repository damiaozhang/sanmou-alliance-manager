/**
 * IPC 边界数据校验工具
 *
 * 设计目标：
 * - 轻量级运行时校验，不引入 zod/yup 等重依赖
 * - 在 IPC 返回值处做基本形状检查，捕获游戏数据格式变更
 * - 提供清晰的错误信息，帮助定位数据结构问题
 * - 仅在开发/调试环境启用，生产环境可选关闭
 *
 * 使用示例：
 * ```ts
 * import { validateIpcResponse } from './ipcValidation';
 *
 * const data = await invoke('get_app_bundle');
 * if (!validateIpcResponse('AppBundle', data)) {
 *   logger.error('IPC 返回数据格式异常', { type: 'AppBundle' });
 *   throw new Error('数据格式校验失败');
 * }
 * ```
 */

import { logger } from "./logger";
import type {
  AppBundle,
  WorkspaceSummary,
  CollectorStatus,
  BattleReportRow,
  LineupStatRow,
  MemberSnapshotRow,
} from "./bindings";

export type IpcTypeName =
  "AppBundle" | "WorkspaceSummary" | "CollectorStatus" | "BattleReportRow" | "LineupStatRow" | "MemberSnapshotRow";

type FieldSpec = {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object" | "any";
  optional?: boolean;
};

type IpcTypes = {
  AppBundle: AppBundle;
  WorkspaceSummary: WorkspaceSummary;
  CollectorStatus: CollectorStatus;
  BattleReportRow: BattleReportRow;
  LineupStatRow: LineupStatRow;
  MemberSnapshotRow: MemberSnapshotRow;
};

type TypeSpecs = {
  [K in IpcTypeName]: {
    name: K;
    fields: (FieldSpec & { name: keyof IpcTypes[K] })[];
  };
};

const TYPE_SPECS: TypeSpecs = {
  AppBundle: {
    name: "AppBundle",
    fields: [
      { name: "allianceMembers", type: "array" },
      { name: "summary", type: "object" },
      { name: "workspaces", type: "array" },
      { name: "lineupProfiles", type: "array" },
    ],
  },
  WorkspaceSummary: {
    name: "WorkspaceSummary",
    fields: [
      { name: "workspaceCount", type: "number" },
      { name: "battleBlockCount", type: "number" },
      { name: "memberSnapshotCount", type: "number" },
    ],
  },
  CollectorStatus: {
    name: "CollectorStatus",
    fields: [
      { name: "available", type: "boolean" },
      { name: "mode", type: "string" },
      { name: "message", type: "string" },
      { name: "captureFlows", type: "object" },
    ],
  },
  BattleReportRow: {
    name: "BattleReportRow",
    fields: [
      { name: "battleCode", type: "string" },
      { name: "time", type: "string" },
      { name: "result", type: "string" },
    ],
  },
  LineupStatRow: {
    name: "LineupStatRow",
    fields: [
      { name: "lineupKey", type: "string" },
      { name: "battles", type: "number" },
      { name: "wins", type: "number" },
    ],
  },
  MemberSnapshotRow: {
    name: "MemberSnapshotRow",
    fields: [
      { name: "avatarId", type: "string" },
      { name: "observedAt", type: "string" },
      { name: "isOnline", type: "number" },
    ],
  },
};

function checkFieldType(value: unknown, expectedType: FieldSpec["type"]): boolean {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "any":
      return true;
  }
}

export function validateIpcResponse(typeName: IpcTypeName, data: unknown): boolean {
  if (data === null || data === undefined) {
    logger.error("IPC 响应为空", { typeName });
    return false;
  }

  if (typeof data !== "object" || Array.isArray(data)) {
    logger.error("IPC 响应非对象类型", { typeName, actualType: typeof data });
    return false;
  }

  const spec = TYPE_SPECS[typeName];
  if (!spec) {
    logger.warn("未知的 IPC 类型，跳过校验", { typeName });
    return true;
  }

  const obj = data as Record<string, unknown>;
  const errors: string[] = [];

  for (const field of spec.fields) {
    const value = obj[field.name];

    if (value === undefined) {
      if (!field.optional) {
        errors.push(`缺少必填字段: ${field.name}`);
      }
      continue;
    }

    if (!checkFieldType(value, field.type)) {
      errors.push(`字段 ${field.name} 类型错误: 期望 ${field.type}, 实际 ${typeof value}`);
    }
  }

  if (errors.length > 0) {
    logger.error("IPC 数据校验失败", { typeName, errors });
    return false;
  }

  return true;
}

export function safeParseIpcResponse<T>(typeName: IpcTypeName, data: unknown): T | null {
  if (validateIpcResponse(typeName, data)) {
    return data as T;
  }
  return null;
}
