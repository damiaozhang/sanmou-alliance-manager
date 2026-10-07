import { create } from "zustand";
import { persist } from "zustand/middleware";

// 全局应用状态：跨页面共享的极简状态通道
// - selectedWorkspaceId：当前选中工作区，需要 localStorage 持久化，跨页面读取
// （通知态已于 S1-3 移出本 store，统一走 src/lib/notify.ts 的 sonner toast）
// 局部 UI 状态（表单、视图切换等）仍留在各组件内，避免过度集中
interface AppState {
  selectedWorkspaceId: number | null;
  setSelectedWorkspaceId: (id: number | null) => void;
  clearSelectedWorkspace: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedWorkspaceId: null,
      setSelectedWorkspaceId: (id) => set({ selectedWorkspaceId: id }),
      clearSelectedWorkspace: () => set({ selectedWorkspaceId: null }),
    }),
    {
      // 仅持久化工作区选择；message 本就靠 partialize 排除，删除无迁移负担（persist name 不变）
      name: "sanmou:app-store-v2",
      partialize: (state) => ({ selectedWorkspaceId: state.selectedWorkspaceId }),
    },
  ),
);
