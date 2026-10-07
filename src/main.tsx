import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppProviders } from "./app/providers";
import { resolveLegacyHash } from "./app/routes";
import { ErrorBoundary } from "./ErrorBoundary";
import "./index.css";
import { isTauriRuntime } from "./lib/runtime";
import { seedPreviewData } from "./previewData";

// 浏览器预览模式（未连接 Tauri）注入样本数据：mock 层初始值为空会让所有页面只剩空态，
// 看不到真实信息密度。仅在 DEV 且非桌面运行时执行，生产构建与桌面运行都不受影响。
if (import.meta.env.DEV && !isTauriRuntime()) {
  seedPreviewData();
}

// 旧 hash（#dashboard / #battles / #autoCapture 等）在 HashRouter 初始化前同步归一化。
// 不能放在 React effect 里做：* 兜底 <Navigate> 的 effect 与重定向 effect 在 StrictMode
// 双效应下存在竞态——Navigate 二次执行会把旧键错误兜底到总览（S2-2 冒烟暴露的既存 bug，
// 单测只覆盖 resolveLegacyHash 纯函数、未覆盖端到端路径）
const legacyTarget = resolveLegacyHash(window.location.hash);
if (legacyTarget) {
  window.history.replaceState(null, "", `#${legacyTarget}`);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppProviders>
        <App />
      </AppProviders>
    </ErrorBoundary>
  </React.StrictMode>
);
