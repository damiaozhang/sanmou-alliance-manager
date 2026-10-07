/**
 * useWorkspaceAutoSelect 回归测试（S1-2 审查修复 C1）
 *
 * 复刻 App 的真实组合：useAppData（react-query 数据层）+ useWorkspaceAutoSelect（自动选择）。
 * tauri 层整体 mock，getAppBundle 用 deferred promise 控制加载时序，验证：
 *  1. 切到未缓存工作区（新 queryKey 无缓存 → workspaces 短暂为空）时选择不被覆盖；
 *  2. 守卫不过度：加载完成后对失效 id 正常回退、空 workspaces 正常清空。
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/app/useWorkspaceAutoSelect.test.tsx
 */

import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBundle, WorkspaceRecord } from "../tauri";
import { useAppStore } from "@/store/appStore";
import { useAppData } from "./queries";
import { useWorkspaceAutoSelect } from "./useWorkspaceAutoSelect";

// ──────── tauri 层 mock：getAppBundle 走 deferred 队列，其余立即兑现 ────────

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const bundleCalls: Array<{ wsId: number | null; d: Deferred<AppBundle> }> = [];

vi.mock("../tauri", () => ({
  getAppBundle: vi.fn((workspaceId?: number | null) => {
    const d = deferred<AppBundle>();
    bundleCalls.push({ wsId: workspaceId ?? null, d });
    return d.promise;
  }),
  getWorkspaceSummary: vi.fn(() =>
    Promise.resolve({
      workspaceCount: 2,
      allianceCount: 2,
      captureSessionCount: 0,
      rawArtifactCount: 0,
      exportJobCount: 0,
      memberSnapshotCount: 0,
      buildingSnapshotCount: 0,
      battleBlockCount: 0,
      lineupProfileCount: 0,
      databasePath: "test",
    }),
  ),
  getCollectorStatus: vi.fn(() =>
    Promise.resolve({ available: false, mode: "test", message: "", captureFlows: {} }),
  ),
  getExportDirectory: vi.fn(() => Promise.resolve({ path: "test://exports", isCustom: false })),
  getLineupAnalysis: vi.fn(() => Promise.resolve({ stats: [], matchups: [] })),
}));

// ──────── 测试基建 ────────

function makeWorkspace(id: number): WorkspaceRecord {
  return {
    id,
    name: `工作区${id}`,
    serverName: "服务器",
    seasonName: "赛季",
    allianceId: id * 10,
    allianceName: `同盟${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeBundle(workspaces: WorkspaceRecord[]): AppBundle {
  return {
    summary: {
      workspaceCount: workspaces.length,
      allianceCount: workspaces.length,
      captureSessionCount: 0,
      rawArtifactCount: 0,
      exportJobCount: 0,
      memberSnapshotCount: 0,
      buildingSnapshotCount: 0,
      battleBlockCount: 0,
      lineupProfileCount: 0,
      databasePath: "test",
    },
    workspaces,
    captureSessions: [],
    rawArtifacts: [],
    exportJobs: [],
    allianceMembers: [],
    allianceFacilities: [],
    allianceGroups: [],
    lineupProfiles: [],
    memberBindings: [],
  };
}

const ws1 = makeWorkspace(1);
const ws2 = makeWorkspace(2);

// 与 App.tsx 完全相同的组合：useAppData 供数 + 自动选择 effect
function useAppLikeHarness() {
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const data = useAppData(selectedWorkspaceId);
  useWorkspaceAutoSelect(data.workspaces, data.isLoading);
  return {
    selectedWorkspaceId,
    workspaces: data.workspaces,
    isLoading: data.isLoading,
  };
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function freshClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  bundleCalls.length = 0;
  useAppStore.setState({ selectedWorkspaceId: null });
  window.localStorage.clear();
});

describe("useWorkspaceAutoSelect + useAppData（S1-2 审查修复 C1）", () => {
  it("切到未缓存工作区：pending 期间与数据到达后选择都不被覆盖", async () => {
    useAppStore.setState({ selectedWorkspaceId: 1 });
    const { result } = renderHook(() => useAppLikeHarness(), {
      wrapper: makeWrapper(freshClient()),
    });

    // 首个 query（ws1）到达，加载完成
    expect(bundleCalls).toHaveLength(1);
    expect(bundleCalls[0].wsId).toBe(1);
    await act(async () => {
      bundleCalls[0].d.resolve(makeBundle([ws1, ws2]));
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.selectedWorkspaceId).toBe(1);

    // 用户切到 ws2：["bundle", 2] 无缓存 → bundle=null → workspaces 短暂为空、isLoading=true
    act(() => {
      useAppStore.getState().setSelectedWorkspaceId(2);
    });
    expect(bundleCalls).toHaveLength(2);
    expect(bundleCalls[1].wsId).toBe(2);
    expect(result.current.isLoading).toBe(true);
    // 守卫生效：effect 重跑后选择不被清成 null、也不被回退到 1
    expect(result.current.selectedWorkspaceId).toBe(2);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.selectedWorkspaceId).toBe(2);

    // ws2 数据到达：workspaces 恢复，选择保持 2
    await act(async () => {
      bundleCalls[1].d.resolve(makeBundle([ws1, ws2]));
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.selectedWorkspaceId).toBe(2);
  });

  it("persist 恢复的失效 id：pending 期间不清空，加载完成后回退第一个", async () => {
    useAppStore.setState({ selectedWorkspaceId: 999 });
    const { result } = renderHook(() => useAppLikeHarness(), {
      wrapper: makeWrapper(freshClient()),
    });

    // 首个 query pending 期间（workspaces 为空）：守卫阻止过早清空
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.selectedWorkspaceId).toBe(999);

    // 数据到达，999 不在 workspaces 中 → 正常回退 workspaces[0]
    await act(async () => {
      bundleCalls[0].d.resolve(makeBundle([ws1, ws2]));
    });
    await waitFor(() => expect(result.current.selectedWorkspaceId).toBe(1));
  });

  it("加载完成后 workspaces 为空：正常清空选择", async () => {
    useAppStore.setState({ selectedWorkspaceId: 5 });
    const { result } = renderHook(() => useAppLikeHarness(), {
      wrapper: makeWrapper(freshClient()),
    });

    await act(async () => {
      bundleCalls[0].d.resolve(makeBundle([]));
    });
    // 清空选择 → queryKey 切到 ["bundle", null]（再次 pending），因此直接等选择变 null
    await waitFor(() => expect(result.current.selectedWorkspaceId).toBeNull());

    // 新 key 数据到达后选择保持 null、不反弹（守卫不过度也不回退）
    expect(bundleCalls).toHaveLength(2);
    expect(bundleCalls[1].wsId).toBeNull();
    await act(async () => {
      bundleCalls[1].d.resolve(makeBundle([]));
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.selectedWorkspaceId).toBeNull();
  });
});
