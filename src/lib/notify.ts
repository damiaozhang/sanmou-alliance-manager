import { toast } from "sonner";

// 全局唯一 toast 入口（S1-3）：对 sonner 的薄封装，App 内所有通知统一走这里。
// 封装的用意：未来换库/调样式只改这一处，不动调用点。
// 文案由调用方原样传入，notify 不做加工。
// 时长策略：success/info 3s，warning 4s，error 6s（错误文案长，给足阅读时间）。
export const notify = {
  success: (msg: string) => toast.success(msg, { duration: 3000 }),
  info: (msg: string) => toast.info(msg, { duration: 3000 }),
  warning: (msg: string) => toast.warning(msg, { duration: 4000 }),
  error: (msg: string) => toast.error(msg, { duration: 6000 }),
};
