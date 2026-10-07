import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  AppSnapshot, CaptureMode, ProcessInfo, TabId, ScanWorkspaceRecord,
} from "../types";
import { CAPTURE_DIR_STORAGE_KEY, LEGACY_SCAN_WORKSPACE_STORAGE_KEY } from "../constants";
import { appendLimited } from "../utils/helpers";
import { normaliseSnapshot } from "../utils/battle";
import { formatErrorMessage } from "@/lib/format";

type AppendClientLog = (level: "info" | "warn" | "error", message: string) => void;

function defaultCaptureDir(): string {
  // 固定默认名，避免按日期漂移导致跨天采集目录变化
  return "default";
}

function readStoredCaptureDir(): string {
  if (typeof window === "undefined") return defaultCaptureDir();
  const storage = window.localStorage;
  const stored = storage.getItem(CAPTURE_DIR_STORAGE_KEY);
  if (stored !== null) return stored.trim();
  // 一次性迁移：新键不存在且旧键（battleGrabberV6.scanWorkspace）存在时，读旧写新；保留旧键不删。
  const legacy = storage.getItem(LEGACY_SCAN_WORKSPACE_STORAGE_KEY);
  if (legacy !== null) {
    storage.setItem(CAPTURE_DIR_STORAGE_KEY, legacy);
    return legacy.trim();
  }
  return defaultCaptureDir();
}

function writeStoredCaptureDir(v: string): void {
  if (typeof window !== "undefined") window.localStorage.setItem(CAPTURE_DIR_STORAGE_KEY, v.trim());
}

export type UseCaptureControlsParams = {
  desktopRuntime: boolean;
  setSnapshot: React.Dispatch<React.SetStateAction<AppSnapshot>>;
  setLiveAllianceRecordCount: React.Dispatch<React.SetStateAction<number>>;
  appendClientLog: AppendClientLog;
  refreshSnapshot: () => Promise<void>;
  resetReportFocus: () => void;
  resetReportSelection: () => void;
  setAllianceNameFilter: React.Dispatch<React.SetStateAction<string>>;
  setAllianceMatchupFilterKey: React.Dispatch<React.SetStateAction<string>>;
  setSelectedTab: (v: TabId) => void;
};

/**
 * 采集连接与采集目录控制：进程/目录列表、连接动作与初始化恢复。
 * 拆分自 BattleGrabberApp 以收敛桌面采集相关的状态与副作用。
 */
export function useCaptureControls(params: UseCaptureControlsParams): {
  processes: ProcessInfo[];
  workspaces: ScanWorkspaceRecord[];
  selectedProcess: string;
  setSelectedProcess: React.Dispatch<React.SetStateAction<string>>;
  captureMode: CaptureMode;
  setCaptureMode: React.Dispatch<React.SetStateAction<CaptureMode>>;
  workspaceDraft: string;
  setWorkspaceDraft: React.Dispatch<React.SetStateAction<string>>;
  busy: boolean;
  refreshProcesses: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  applyScanWorkspaceSetting: () => Promise<void>;
  connect: () => Promise<void>;
  startAllianceListener: () => Promise<void>;
  disconnect: () => Promise<void>;
} {
  const {
    desktopRuntime, setSnapshot, setLiveAllianceRecordCount, appendClientLog,
    refreshSnapshot, resetReportFocus, resetReportSelection,
    setAllianceNameFilter, setAllianceMatchupFilterKey, setSelectedTab,
  } = params;

  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<ScanWorkspaceRecord[]>([]);
  const [selectedProcess, setSelectedProcess] = useState("");
  const [captureMode, setCaptureMode] = useState<CaptureMode>("passive");
  const [workspaceDraft, setWorkspaceDraft] = useState(() => readStoredCaptureDir());
  const [busy, setBusy] = useState(false);

  const refreshProcesses = useCallback(async (): Promise<void> => {
    if (!desktopRuntime) {
      setProcesses([]);
      appendClientLog("warn", "浏览器预览模式无法连接游戏进程，请在 Tauri 桌面应用中使用战报采集。");
      return;
    }
    try {
      const items = await invoke<ProcessInfo[]>("list_processes");
      setProcesses(items);
      setSelectedProcess((current) => current || items[0]?.name || "");
      if (items.length === 0) appendClientLog("warn", "未找到可用游戏进程，请确认游戏已启动。");
    } catch (e) { setProcesses([]); appendClientLog("error", `加载进程列表失败: ${formatErrorMessage(e)}`); }
  }, [appendClientLog, desktopRuntime]);

  const refreshWorkspaces = useCallback(async (): Promise<void> => {
    if (!desktopRuntime) { setWorkspaces([]); return; }
    try { setWorkspaces(await invoke<ScanWorkspaceRecord[]>("list_scan_workspaces")); }
    catch (e) { setWorkspaces([]); appendClientLog("error", `加载目录列表失败: ${formatErrorMessage(e)}`); }
  }, [appendClientLog, desktopRuntime]);

  async function applyScanWorkspaceSetting(): Promise<void> {
    if (!desktopRuntime) {
      const next = workspaceDraft.trim();
      setWorkspaceDraft(next); writeStoredCaptureDir(next);
      setSnapshot((current) => ({ ...current, scanWorkspace: next, workspaceOutputDir: "" }));
      appendClientLog("warn", "浏览器预览模式仅保存采集目录名称，不会切换桌面采集目录。");
      return;
    }
    setBusy(true);
    try {
      const p = await invoke<AppSnapshot>("set_scan_workspace", { workspace: workspaceDraft });
      const n = normaliseSnapshot(p);
      // P2-2 Phase 1：快照不再带全量记录，条数取自 allianceRecordCount（取数由拉取 effect 负责）
      setSnapshot(n); setLiveAllianceRecordCount(n.allianceRecordCount);
      setWorkspaceDraft(n.scanWorkspace); writeStoredCaptureDir(n.scanWorkspace);
      resetReportSelection(); setAllianceNameFilter(""); setAllianceMatchupFilterKey("");
      appendClientLog("info", n.scanWorkspace ? `采集目录已切换到 ${n.scanWorkspace}` : "采集目录已切换到默认 output");
      await refreshWorkspaces();
    } catch (e) { appendClientLog("error", `切换采集目录失败: ${formatErrorMessage(e)}`); }
    finally { setBusy(false); }
  }

  async function connect(): Promise<void> {
    if (!desktopRuntime) {
      appendClientLog("warn", "浏览器预览模式无法连接游戏进程，请在 Tauri 桌面应用中启动采集。");
      return;
    }
    if (!selectedProcess) return;
    setBusy(true);
    try { resetReportFocus(); await invoke("connect_process", { args: { processName: selectedProcess, mode: captureMode } }); }
    catch (e) { appendClientLog("error", `连接游戏进程失败: ${formatErrorMessage(e)}`); }
    finally { setBusy(false); }
  }

  async function startAllianceListener(): Promise<void> {
    if (!desktopRuntime) {
      appendClientLog("warn", "浏览器预览模式无法启动同盟协议监听，请在 Tauri 桌面应用中使用。");
      return;
    }
    setBusy(true);
    try { setCaptureMode("passive"); resetReportFocus(); await invoke("connect_process", { args: { processName: selectedProcess, mode: "passive" } }); setSelectedTab("alliance"); }
    catch (e) { appendClientLog("error", `同盟协议监听启动失败: ${formatErrorMessage(e)}`); }
    finally { setBusy(false); }
  }

  async function disconnect(): Promise<void> {
    if (!desktopRuntime) { appendClientLog("warn", "浏览器预览模式没有可断开的桌面采集连接。"); return; }
    setBusy(true);
    try { await invoke("disconnect_process"); await refreshSnapshot(); }
    catch (e) { appendClientLog("error", `断开游戏进程失败: ${formatErrorMessage(e)}`); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    void (async () => {
      const ws = readStoredCaptureDir();
      if (!desktopRuntime) {
        setWorkspaceDraft(ws);
        setSnapshot((current) => ({
          ...current,
          scanWorkspace: ws,
          logs: appendLimited(current.logs, {
            level: "warn",
            message: "浏览器预览模式未连接 Tauri sidecar，战报采集功能在桌面应用中可用。",
            timestamp: new Date().toISOString(),
          }, 500),
        }));
        return;
      }
      try {
        const p = await invoke<AppSnapshot>("set_scan_workspace", { workspace: ws });
        const n = normaliseSnapshot(p);
        setSnapshot(n); setLiveAllianceRecordCount(n.allianceRecordCount);
        setWorkspaceDraft(n.scanWorkspace); writeStoredCaptureDir(n.scanWorkspace);
      } catch (e) { appendClientLog("error", `恢复采集目录失败: ${formatErrorMessage(e)}`); await refreshSnapshot(); }
      await refreshWorkspaces(); await refreshProcesses();
    })();
  }, [appendClientLog, desktopRuntime, refreshProcesses, refreshSnapshot, refreshWorkspaces, setLiveAllianceRecordCount, setSnapshot]);

  return {
    processes, workspaces, selectedProcess, setSelectedProcess,
    captureMode, setCaptureMode, workspaceDraft, setWorkspaceDraft, busy,
    refreshProcesses, refreshWorkspaces, applyScanWorkspaceSetting,
    connect, startAllianceListener, disconnect,
  };
}
