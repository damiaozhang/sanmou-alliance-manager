// 手写文件（非 ts-rs 生成），随 bindings 目录入库。
//
// 原因：Rust 侧 CaptureSessionCapture 是 #[serde(untagged)] 枚举
// （Typed(Box<CollectorCapturePayload>) | Raw(serde_json::Value)），ts-rs 只能导出联合类型，
// 前端 summarizeSessionNote / AllianceDataPage 等读取点依赖 capture.captureType、
// capture.runtime.recordCount 这类「合并后全可选」的形状，联合类型无法通过 strict 编译。
// 因此 bindings 侧保留此手写合并形状，CaptureSessionSummaryRecord.capture 经
// #[ts(type = "import(\"./CaptureSessionCapture\").CaptureSessionCapture")] 指向本文件。
//
// 维护规则：Rust CollectorCapturePayload 新增/重命名字段时，在此同步补对应可选字段。
export type CaptureSessionCapture = {
  collectorMode?: string;
  captureType?: string;
  flow?: string;
  expectedArtifacts?: string[];
  navigation?: string[];
  nextProbe?: string | null;
  preview?: Record<string, unknown> | null;
  runtime?: Record<string, unknown> | null;
  evidence?: Record<string, unknown> | null;
  error?: string;
  [key: string]: unknown;
};
