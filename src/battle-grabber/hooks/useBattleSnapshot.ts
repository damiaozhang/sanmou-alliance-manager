import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { AppSnapshot, BridgeEventPayload, JsonRecord, LiveCaptureSnapshot } from "../types";
import { BRIDGE_EVENT_FLUSH_INTERVAL_MS, LIVE_CAPTURE_POLL_INTERVAL_MS, SNAPSHOT_REFRESH_DEBOUNCE_MS } from "../constants";
import { appendLimited } from "../utils/helpers";
import { applyBridgeEvents, applyLiveCaptureSnapshot, normaliseSnapshot } from "../utils/battle";
import { getAppSnapshot, type AppSnapshotResponse } from "@/tauri";
import { formatErrorMessage } from "@/lib/format";

const EMPTY_SNAPSHOT: AppSnapshot = {
  version: 0,
  scanWorkspace: "", workspaceOutputDir: "",
  connection: { status: "disconnected", mode: "", sessionId: "", outputDir: "", remoteCaptureDir: "", installed: false, process: null },
  logs: [], packets: [], reports: [], sessions: [], alliancePackets: [], allianceRecords: [],
  allianceRecordCount: 0,
};

type AppendClientLog = (level: "info" | "warn" | "error", message: string) => void;

/**
 * 战报扫描器应用状态管理：snapshot 状态、刷新、桥事件聚合与实时采集轮询。
 */
export function useBattleSnapshot(desktopRuntime: boolean): {
  snapshot: AppSnapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<AppSnapshot>>;
  liveAllianceRecordCount: number;
  setLiveAllianceRecordCount: React.Dispatch<React.SetStateAction<number>>;
  appendClientLog: AppendClientLog;
  refreshSnapshot: () => Promise<void>;
  refreshLiveCaptureSnapshot: () => Promise<void>;
  connectionReady: boolean;
} {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT);
  const [liveAllianceRecordCount, setLiveAllianceRecordCount] = useState(0);

  const bridgeEventQueueRef = useRef<BridgeEventPayload[]>([]);
  const bridgeFlushTimerRef = useRef<number | null>(null);
  const snapshotRefreshTimerRef = useRef<number | null>(null);
  // 阶段3b：snapshot 版本协商基线，get_app_snapshot(sinceVersion) 仅在 changed=true 时 setState
  const snapshotVersionRef = useRef<number | null>(null);
  // P2-2 Phase 1：allianceRecords 改为本地按需拉取，需要一份最新 snapshot 供
  // normaliseSnapshot 保留已拉取的数据（不能依赖闭包里的旧 snapshot）。
  const snapshotRef = useRef<AppSnapshot>(EMPTY_SNAPSHOT);
  // 已拉取记录对应的 "workspace:条数" 键，避免重复拉取
  const allianceFetchKeyRef = useRef("");

  const appendClientLog = useCallback<AppendClientLog>((level, message) => {
    setSnapshot((c) => ({ ...c, logs: appendLimited(c.logs, { level, message, timestamp: new Date().toISOString() }, 500) }));
  }, []);

  // 应用快照响应：changed=false 时不携带 snapshot，直接跳过；否则更新版本基线并 setState
  const applySnapshotResponse = useCallback((resp: AppSnapshotResponse) => {
    if (!resp.changed || !resp.snapshot) return;
    snapshotVersionRef.current = resp.version;
    const n = normaliseSnapshot(resp.snapshot, snapshotRef.current);
    snapshotRef.current = n;
    setSnapshot(n);
    setLiveAllianceRecordCount(n.allianceRecordCount);
  }, []);

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    if (!desktopRuntime) {
      setSnapshot((current) => current);
      setLiveAllianceRecordCount(0);
      return;
    }
    try {
      // 手动/初始刷新：sinceVersion=null 强制全量，重置版本基线
      const resp = await getAppSnapshot(null);
      snapshotVersionRef.current = resp.version;
      if (resp.snapshot) {
        const n = normaliseSnapshot(resp.snapshot, snapshotRef.current);
        snapshotRef.current = n;
        setSnapshot(n);
        setLiveAllianceRecordCount(n.allianceRecordCount);
      }
    } catch (e) { appendClientLog("error", `加载应用状态失败: ${formatErrorMessage(e)}`); }
  }, [appendClientLog, desktopRuntime]);

  const refreshLiveCaptureSnapshot = useCallback(async (): Promise<void> => {
    if (!desktopRuntime) return;
    const p = await invoke<LiveCaptureSnapshot>("get_live_capture_snapshot");
    setSnapshot((c) => {
      const n = applyLiveCaptureSnapshot(c, p);
      snapshotRef.current = n;
      return n;
    });
    setLiveAllianceRecordCount(p.allianceRecordCount);
  }, [desktopRuntime]);

  // P2-2 Phase 1：同盟战报记录按需拉取。
  // 此前快照每次都整包下发（单 workspace 可达 60+ MB），现在只在
  // 「工作区变化」或「后端报告条数变化」时调用一次 get_alliance_records。
  useEffect(() => {
    if (!desktopRuntime) return;
    const count = Math.max(snapshot.allianceRecordCount, liveAllianceRecordCount);
    if (count === 0) return;
    const key = `${snapshot.scanWorkspace}:${count}`;
    if (allianceFetchKeyRef.current === key) return;
    allianceFetchKeyRef.current = key;
    let disposed = false;
    void invoke<JsonRecord[]>("get_alliance_records", { scanWorkspace: snapshot.scanWorkspace || null })
      .then((records) => {
        if (disposed) return;
        setSnapshot((c) => {
          const n = { ...c, allianceRecords: records, allianceRecordCount: records.length };
          snapshotRef.current = n;
          return n;
        });
      })
      .catch((e) => {
        // 拉取失败时清掉键，让下次条数变化或刷新可以重试
        allianceFetchKeyRef.current = "";
        if (disposed) return;
        setSnapshot((c) => ({ ...c, logs: appendLimited(c.logs, { level: "error", message: `加载同盟战报记录失败: ${formatErrorMessage(e)}`, timestamp: new Date().toISOString() }, 500) }));
      });
    return () => { disposed = true; };
  }, [appendClientLog, desktopRuntime, liveAllianceRecordCount, snapshot.allianceRecordCount, snapshot.scanWorkspace]);

  // 桥事件聚合：session_summary 触发防抖刷新，其余事件批量 flush 合入 snapshot。
  useEffect(() => {
    if (!desktopRuntime) return;
    const flush = () => {
      bridgeFlushTimerRef.current = null;
      const evts = bridgeEventQueueRef.current; bridgeEventQueueRef.current = [];
      if (evts.length > 0) setSnapshot((c) => applyBridgeEvents(c, evts));
    };
    const scheduleFlush = () => { if (bridgeFlushTimerRef.current === null) bridgeFlushTimerRef.current = window.setTimeout(flush, BRIDGE_EVENT_FLUSH_INTERVAL_MS); };
    const scheduleRefresh = () => {
      if (snapshotRefreshTimerRef.current !== null) return;
      snapshotRefreshTimerRef.current = window.setTimeout(() => {
        snapshotRefreshTimerRef.current = null;
        void getAppSnapshot(snapshotVersionRef.current).then((resp) => { applySnapshotResponse(resp); }).catch((e) => {
          setSnapshot((c) => ({ ...c, logs: appendLimited(c.logs, { level: "error", message: `加载应用状态失败: ${formatErrorMessage(e)}`, timestamp: new Date().toISOString() }, 500) }));
        });
      }, SNAPSHOT_REFRESH_DEBOUNCE_MS);
    };
    const unreg = listen<BridgeEventPayload>("bridge-event", ({ payload }) => {
      if (payload.type === "session_summary") { scheduleRefresh(); return; }
      if (payload.type === "alliance_packet") return;
      bridgeEventQueueRef.current.push(payload); scheduleFlush();
    });
    return () => {
      if (bridgeFlushTimerRef.current !== null) { window.clearTimeout(bridgeFlushTimerRef.current); bridgeFlushTimerRef.current = null; }
      if (snapshotRefreshTimerRef.current !== null) { window.clearTimeout(snapshotRefreshTimerRef.current); snapshotRefreshTimerRef.current = null; }
      bridgeEventQueueRef.current = [];
      void unreg.then((u) => u());
    };
  }, [applySnapshotResponse, desktopRuntime]);

  // 阶段3b：事件驱动刷新——后端入库后 emit snapshot-updated（payload 为新 version），
  // 前端据此调 get_app_snapshot(sinceVersion) 协商，仅 changed=true 才 setState。
  useEffect(() => {
    if (!desktopRuntime) return;
    let disposed = false;
    const unreg = listen<number>("battle-grabber://snapshot-updated", () => {
      if (disposed) return;
      void getAppSnapshot(snapshotVersionRef.current).then((resp) => {
        if (!disposed) applySnapshotResponse(resp);
      }).catch((e) => {
        if (!disposed) setSnapshot((c) => ({ ...c, logs: appendLimited(c.logs, { level: "error", message: `刷新应用快照失败: ${formatErrorMessage(e)}`, timestamp: new Date().toISOString() }, 500) }));
      });
    });
    return () => { disposed = true; void unreg.then((u) => u()); };
  }, [applySnapshotResponse, desktopRuntime]);

  const connectionReady = snapshot.connection.status === "connected" || snapshot.connection.status === "ready";

  // 连接就绪后低频兜底轮询实时采集状态（主路径已改事件驱动，5s 仅防丢事件）。
  useEffect(() => {
    if (!desktopRuntime || !connectionReady) return;
    let disposed = false;
    const refresh = () => {
      void refreshLiveCaptureSnapshot().catch((e) => {
        if (!disposed) setSnapshot((c) => ({ ...c, logs: appendLimited(c.logs, { level: "error", message: `刷新实时采集状态失败: ${formatErrorMessage(e)}`, timestamp: new Date().toISOString() }, 500) }));
      });
    };
    refresh();
    const timer = window.setInterval(refresh, LIVE_CAPTURE_POLL_INTERVAL_MS);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [connectionReady, desktopRuntime, refreshLiveCaptureSnapshot]);

  return {
    snapshot,
    setSnapshot,
    liveAllianceRecordCount,
    setLiveAllianceRecordCount,
    appendClientLog,
    refreshSnapshot,
    refreshLiveCaptureSnapshot,
    connectionReady,
  };
}
