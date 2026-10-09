/**
 * 轻量级前端日志模块
 *
 * 设计目标：
 * - 零依赖，不引入 loglevel/winston 等库
 * - 支持日志级别控制（debug/info/warn/error）
 * - 在浏览器 mock 环境下降级为 console
 * - 可选扩展：如需文件日志，安装 @tauri-apps/plugin-fs 后启用 enableFileLogging()
 *
 * 使用示例：
 * ```ts
 * import { logger } from './logger';
 * logger.info('采集开始', { captureType: 'alliance_data' });
 * logger.error('IPC 调用失败', { error: err.message });
 * ```
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const formatted = formatMessage(level, message, context);

  switch (level) {
    case "debug":
      console.debug(formatted);
      break;
    case "info":
      console.info(formatted);
      break;
    case "warn":
      console.warn(formatted);
      break;
    case "error":
      console.error(formatted);
      break;
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("error", message, context),
};
