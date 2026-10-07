// 日期/时间工具（阶段4 自 helpers.ts 拆出，单一落点）

/** 形如 2024-03-15 或 2024-03-15T10:30:00Z 的输入才做时区解释；
 *  其余（"2024"、"" 等畸形输入）保持旧的宽容行为——原样截取前 10 字符。 */
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;

/**
 * 日期 key（YYYY-MM-DD），**按本地时区**解释完整时间戳。
 *
 * 旧实现是 `value.slice(0, 10)`，取的是 UTC 日期，与 localDateKey（本地）口径不一致：
 * 在 UTC+8 的凌晨 00:00–07:59，当天所有记录的 dateKey 都落在前一天，直接后果是
 * 总览页「今日战报」恒为 0、战报时间线按天分组错位（S3-1 时区修复漏掉了本函数）。
 */
export function dateKey(value: string) {
  if (!DATE_LIKE.test(value)) return value.slice(0, 10);
  // 纯日期串不带时刻，直接原样返回，避免被当作 UTC 午夜后本地化而偏移一天
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return localDateKey(d);
}

/**
 * 本地日期 key（YYYY-MM-DD），取自 Date 的本地年月日，不经过 toISOString——
 * toISOString 转 UTC 会让本地晚间（如 UTC+8）的「今天」被算成 UTC 的明天（S3-1 时区修复）。
 */
export function localDateKey(d: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 本周起始（周一 00:00，本地时区）。getDay() 周日为 0，+6 % 7 把周一归一为 0（S3-1 周起始修复）。 */
export function mondayWeekStart(now: Date) {
  const start = new Date(now);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  start.setHours(0, 0, 0, 0);
  return start;
}

export function formatCaptureRecordId(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes()
  )}-${pad(date.getSeconds())}`;
}

export function formatCaptureRecordTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

export function formatUnixSeconds(value?: number | null) {
  if (!value) return "-";
  return new Date(value * 1000).toLocaleString('zh-CN');
}
