// 采集中心主路径组件测试（阶段4）：启动采集 → 乐观会话 → 事件完成后刷新
// mock 层：tauri IPC wrappers（invoke 边界）+ @tauri-apps/api/event 的 listen

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── mock：tauri 模块（invoke 边界） ──
vi.mock("../tauri", () => ({
  isTauriRuntime: () => true,
  getAppBundle: (...args: unknown[]) => mockImpls.getAppBundle(...args),
  getWorkspaceSummary: () => Promise.resolve({}),
  getCollectorStatus: () => Promise.resolve({ runtimeProbe: null }),
  getExportDirectory: () => Promise.resolve({ path: "" }),
  getLineupAnalysis: () => Promise.resolve({ stats: [], matchups: [] }),
  startCaptureSession: (...args: unknown[]) => mockImpls.startCaptureSession(...args),
  stopCaptureSession: () => Promise.resolve({ ok: true }),
  deleteCaptureSession: (...args: unknown[]) => mockImpls.deleteCaptureSession(...args),
  // mutations.ts 还导入以下函数（本测试不触发，但模块求值需存在）
  createWorkspace: () => Promise.reject(new Error("not used in this test")),
  saveMemberBinding: () => Promise.reject(new Error("not used in this test")),
  saveMemberBindings: () => Promise.reject(new Error("not used in this test")),
  saveLineupProfile: () => Promise.reject(new Error("not used in this test")),
  pickExportDirectory: () => Promise.reject(new Error("not used in this test")),
  resetExportDirectory: () => Promise.reject(new Error("not used in this test")),
  upsertLineupStatsBatch: () => Promise.reject(new Error("not used in this test")),
  upsertLineupMatchupsBatch: () => Promise.reject(new Error("not used in this test")),
}));

// ── mock：Tauri 事件总线 listen（useCaptureEvents 依赖） ──
type EventHandler = (event: { payload: { sessionId: number; ok: boolean; error?: string | null } }) => void;
const listenHandlers: { handler: EventHandler | null } = { handler: null };
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, handler: EventHandler) => {
    listenHandlers.handler = handler;
    return Promise.resolve(() => {
      listenHandlers.handler = null;
    });
  }),
}));

const mockImpls = {
  getAppBundle: vi.fn(),
  startCaptureSession: vi.fn(),
  deleteCaptureSession: vi.fn(),
};

import { CaptureHubPage } from "./CaptureHubPage";
import { useCaptureEvents } from "@/app/useCaptureEvents";
import { useAppStore } from "@/store/appStore";

const WORKSPACE = {
  id: 1,
  name: "默认工作区",
  serverName: "S1",
  seasonName: "2026",
  allianceName: "测试同盟",
  allianceGameId: null,
};

function emptyBundle() {
  return { workspaces: [WORKSPACE], captureSessions: [], allianceMembers: [] };
}

function completedBundle() {
  return {
    workspaces: [WORKSPACE],
    allianceMembers: [],
    captureSessions: [
      {
        id: 42,
        workspaceId: 1,
        captureType: "alliance_data",
        status: "completed",
        startedAt: "2026-08-04T10:00:00Z",
        finishedAt: "2026-08-04T10:00:05Z",
        summaryJson: "",
        summary: null,
      },
    ],
  };
}

function EventsBridge() {
  // 与 App 顶层一致：挂载事件监听，把 capture-session-finished 转为分片失效
  useCaptureEvents();
  return null;
}

function renderHub() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EventsBridge />
        <CaptureHubPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CaptureHubPage 主路径：启动采集 → 乐观会话 → 事件完成后刷新", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listenHandlers.handler = null;
    useAppStore.setState({ selectedWorkspaceId: 1 });
    mockImpls.getAppBundle.mockImplementation(() => Promise.resolve(emptyBundle()));
    mockImpls.startCaptureSession.mockImplementation(() =>
      Promise.resolve({ status: "running", sessionId: 42, startedAt: "2026-08-04T10:00:00Z" }),
    );
  });

  it("启动采集：立即出现乐观运行卡；完成事件驱动刷新后运行卡消失、历史留下已完成会话", async () => {
    renderHub();

    // 初始：等待首个 bundle 到达后页面显示启动入口
    // （forceMount 下历史 tab 空态 CTA 与 PageShell 主操作同名，取第一个即 PageShell 主操作）
    await screen.findAllByRole("button", { name: "采集同盟数据" });
    expect(screen.queryByText(/开始于/)).not.toBeInTheDocument();

    // 1) 启动采集 → 乐观会话立即渲染运行卡（bundle 里还没有会话 42）
    fireEvent.click(screen.getAllByRole("button", { name: "采集同盟数据" })[0]);
    await screen.findByText(/开始于/);
    expect(screen.getByText("采集进行中：请在游戏中打开/刷新同盟成员、日志或设施界面，采集到数据后会自动停止。")).toBeInTheDocument();
    expect(mockImpls.startCaptureSession).toHaveBeenCalledWith(1, null, "alliance_data");

    // 2) 后端完成：bundle 更新为已完成会话，经 capture-session-finished 事件驱动失效刷新
    mockImpls.getAppBundle.mockImplementation(() => Promise.resolve(completedBundle()));
    await waitFor(() => expect(listenHandlers.handler).not.toBeNull());
    listenHandlers.handler!({ payload: { sessionId: 42, ok: true } });

    // 3) 运行卡消失（乐观项被真实已完成行替换并收尾），历史 tab 出现「已完成」
    await waitFor(() => expect(screen.queryByText(/开始于/)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "会话历史" }));
    expect(await screen.findByText("已完成")).toBeInTheDocument();
  });

  it("启动失败（无 sessionId）时不产生乐观会话", async () => {
    mockImpls.startCaptureSession.mockImplementation(() =>
      Promise.resolve({ status: "failed", startedAt: "2026-08-04T10:00:00Z" }),
    );
    renderHub();

    await screen.findAllByRole("button", { name: "采集同盟数据" });
    fireEvent.click(screen.getAllByRole("button", { name: "采集同盟数据" })[0]);

    // 失败路径：不应出现运行卡文案
    await waitFor(() =>
      expect(screen.queryByText("采集进行中：请在游戏中打开/刷新同盟成员、日志或设施界面，采集到数据后会自动停止。")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/开始于/)).not.toBeInTheDocument();
  });

  it("会话历史：删除按钮确认后调用 deleteCaptureSession 并刷新列表", async () => {
    mockImpls.getAppBundle.mockImplementation(() => Promise.resolve(completedBundle()));
    mockImpls.deleteCaptureSession.mockImplementation(() => Promise.resolve());
    renderHub();

    // 切到会话历史 tab，看到已完成会话
    fireEvent.click(screen.getByRole("tab", { name: "会话历史" }));
    expect(await screen.findByText("已完成")).toBeInTheDocument();

    // 点击删除按钮 → 弹出确认框
    const deleteButton = screen.getByRole("button", { name: "删除此会话历史" });
    fireEvent.click(deleteButton);
    expect(await screen.findByText("删除此会话？")).toBeInTheDocument();

    // 确认删除前先把刷新后的 bundle 设为空（删除成功后 onDeleted 会触发刷新）
    mockImpls.getAppBundle.mockImplementation(() => Promise.resolve(emptyBundle()));

    // 确认删除 → 调用后端删除命令（带 sessionId 和 workspaceId）
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => {
      expect(mockImpls.deleteCaptureSession).toHaveBeenCalledWith(42, 1);
    });

    // 删除成功后列表刷新为空态
    await waitFor(() => expect(screen.getByText("还没有采集记录")).toBeInTheDocument());
  });

  it("会话历史：删除失败时展示错误信息并保留会话", async () => {
    mockImpls.getAppBundle.mockImplementation(() => Promise.resolve(completedBundle()));
    mockImpls.deleteCaptureSession.mockImplementation(() =>
      Promise.reject(new Error("删除失败：文件被占用")),
    );
    renderHub();

    fireEvent.click(screen.getByRole("tab", { name: "会话历史" }));
    expect(await screen.findByText("已完成")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除此会话历史" }));
    await screen.findByText("删除此会话？");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(await screen.findByText("删除失败：文件被占用")).toBeInTheDocument();
    // 会话仍在列表（未删除）
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });
});
