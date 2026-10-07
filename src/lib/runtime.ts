// 运行时环境检测工具
// 判断当前是否运行在 Tauri 桌面环境中（而非浏览器预览模式）

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
