import {
  exportBundleCsv,
  exportBundleJson,
  exportBundleXlsx,
  exportBundleHtml,
  exportAllianceMemberDataCsv,
  exportLineupLibraryCsv,
  exportLineupLibraryJson,
  exportLineupLibraryHtml,
} from "../../tauri";

// 导出动作配置表：把 8 个同构 handler 压成一份配置 + 一个生成器
// label/missingMsg/exporter 三参数差异均在此声明，新增格式只需追加一行
// （S2-4 自 App.tsx 外移，纯搬运，配置内容未改；runExport/exportActions 仍留 App.tsx）
export type ExportKey =
  | "allianceJson"
  | "allianceCsv"
  | "allianceXlsx"
  | "allianceHtml"
  | "allianceMemberCsv"
  | "lineupJson"
  | "lineupCsv"
  | "lineupHtml";

export interface ExportConfig {
  key: ExportKey;
  label: string;
  missingMsg: string;
  exporter: (workspaceId: number) => Promise<{ paths: string[] }>;
}

export const exportConfigs: ExportConfig[] = [
  { key: "allianceJson", label: "数据导出", missingMsg: "请先选择工作区，再进行数据导出。", exporter: exportBundleJson },
  { key: "allianceCsv", label: "数据导出", missingMsg: "请先选择工作区，再进行数据导出。", exporter: exportBundleCsv },
  { key: "allianceXlsx", label: "数据导出", missingMsg: "请先选择工作区，再进行数据导出。", exporter: exportBundleXlsx },
  { key: "allianceHtml", label: "数据导出", missingMsg: "请先选择工作区，再进行数据导出。", exporter: exportBundleHtml },
  { key: "allianceMemberCsv", label: "成员导出", missingMsg: "请先选择工作区，再进行成员导出。", exporter: exportAllianceMemberDataCsv },
  { key: "lineupJson", label: "阵容导出", missingMsg: "请先选择工作区，再进行阵容导出。", exporter: exportLineupLibraryJson },
  { key: "lineupCsv", label: "阵容导出", missingMsg: "请先选择工作区，再进行阵容导出。", exporter: exportLineupLibraryCsv },
  { key: "lineupHtml", label: "阵容导出", missingMsg: "请先选择工作区，再进行阵容导出。", exporter: exportLineupLibraryHtml },
];
