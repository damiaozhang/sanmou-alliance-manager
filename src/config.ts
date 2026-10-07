interface ScanConfig {
  // 阶段3b：采集完成改事件驱动（capture-session-finished），此间隔仅作页面可见时的低频兜底 refetch
  fallbackRefetchMs: number;
}

interface UiConfig {
  sidebarWidth: number;
  defaultPageSize: number;
  captureSessionPreviewLimit: number;
}

interface BattleGrabberConfig {
  visiblePacketLimit: number;
  visibleLogLimit: number;
  livePollIntervalMs: number;
}

export interface AppConfig {
  scan: ScanConfig;
  ui: UiConfig;
  battleGrabber: BattleGrabberConfig;
}

export const CONFIG: AppConfig = {
  scan: {
    fallbackRefetchMs: 15_000,                // 15 seconds
  },
  ui: {
    sidebarWidth: 240,
    defaultPageSize: 20,
    captureSessionPreviewLimit: 20,
  },
  battleGrabber: {
    visiblePacketLimit: 200,
    visibleLogLimit: 500,
    livePollIntervalMs: 3000,
  },
};
