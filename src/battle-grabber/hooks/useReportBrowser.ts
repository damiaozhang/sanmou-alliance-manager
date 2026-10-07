import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  AppSnapshot, BattleDetails, JsonRecord, ReportRecord,
  SessionRecord, SummaryPair, TabId, TopUnitSummary,
} from "../types";
import { asRecord } from "../utils/helpers";
import {
  buildReportFallbackPayload, dedupeReports, deriveReportDetails,
  getReportJsonPath, getReportTextPath, parseBattleDetails, parseSummaryPairs,
  parseTopUnits, reportKey, sessionHasUsefulRecords, sortReportsNewestFirst,
} from "../utils/battle";
import { formatErrorMessage } from "@/lib/format";

type AppendClientLog = (level: "info" | "warn" | "error", message: string) => void;

/**
 * 战报浏览与选择：聚合实时/历史战报，管理选中报告、会话与详情加载。
 * 拆分自 BattleGrabberApp 以收敛报告相关的状态、memos 与副作用。
 */
export function useReportBrowser(
  snapshot: AppSnapshot,
  selectedTab: TabId,
  desktopRuntime: boolean,
  appendClientLog: AppendClientLog,
): {
  currentReports: ReportRecord[];
  allReports: ReportRecord[];
  usefulSessions: SessionRecord[];
  emptySessions: SessionRecord[];
  selectedReport: ReportRecord | null;
  selectedReportId: string;
  setSelectedReportId: (id: string) => void;
  selectedSessionId: string;
  setSelectedSessionId: (id: string) => void;
  focusedReportSessionId: string;
  setFocusedReportSessionId: (id: string) => void;
  visibleReports: ReportRecord[];
  visibleReportSessionId: string;
  loadingReport: boolean;
  reportDetails: ReturnType<typeof deriveReportDetails>;
  parsedBattleDetails: BattleDetails | null;
  summaryEventTypes: SummaryPair[];
  summaryTopSkills: SummaryPair[];
  summaryTopUnits: TopUnitSummary[];
  resetReportFocus: () => void;
  resetReportSelection: () => void;
} {
  const [selectedReportId, setSelectedReportId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [focusedReportSessionId, setFocusedReportSessionId] = useState("");
  const [selectedReportPayload, setSelectedReportPayload] = useState<JsonRecord | null>(null);
  const [selectedReportText, setSelectedReportText] = useState("");
  const [loadingReport, setLoadingReport] = useState(false);
  // 报告详情加载竞态防护：快速连续点选时只应用最后一次请求的结果
  const reportLoadSeqRef = useRef(0);

  const currentReports = useMemo(() => sortReportsNewestFirst(dedupeReports(snapshot.reports)), [snapshot.reports]);
  const historyReports = useMemo(() => sortReportsNewestFirst(dedupeReports(snapshot.sessions.flatMap((s) => s.reports))), [snapshot.sessions]);
  const allReports = useMemo(() => sortReportsNewestFirst(dedupeReports([...currentReports, ...historyReports])), [currentReports, historyReports]);
  const usefulSessions = useMemo(() => snapshot.sessions.filter(sessionHasUsefulRecords), [snapshot.sessions]);
  const emptySessions = useMemo(() => snapshot.sessions.filter((s) => !sessionHasUsefulRecords(s)), [snapshot.sessions]);
  const reportsBySession = useMemo(() => {
    const map = new Map<string, ReportRecord[]>();
    for (const r of allReports) { const arr = map.get(r.sessionId) ?? []; arr.push(r); map.set(r.sessionId, arr); }
    return map;
  }, [allReports]);
  const selectedReport = useMemo(() => allReports.find((r) => reportKey(r) === selectedReportId) ?? null, [allReports, selectedReportId]);
  const selectedSession = useMemo(() => snapshot.sessions.find((s) => s.id === selectedSessionId) ?? null, [snapshot.sessions, selectedSessionId]);
  const sessionReports = useMemo(() => sortReportsNewestFirst(dedupeReports(selectedSession?.reports ?? [])), [selectedSession]);
  const liveReportSessionId = currentReports[0]?.sessionId ?? "";
  const visibleReports = useMemo(() => {
    const isLive = (selectedTab === "battle" || selectedTab === "stats") && currentReports.length > 0;
    if (isLive) return currentReports;
    const pref = focusedReportSessionId || selectedSessionId;
    if (pref) { const r = reportsBySession.get(pref) ?? []; if (r.length > 0) return r; }
    return sessionReports.length > 0 ? sessionReports : allReports;
  }, [allReports, focusedReportSessionId, currentReports, reportsBySession, selectedSessionId, selectedTab, sessionReports]);
  const reportDetails = useMemo(() => deriveReportDetails(selectedReportPayload, selectedReportText), [selectedReportPayload, selectedReportText]);
  const parsedBattleDetails = useMemo(() => parseBattleDetails(reportDetails.battleDetails), [reportDetails.battleDetails]);
  const summaryEventTypes = useMemo(() => parseSummaryPairs(reportDetails.summary["event_types"]), [reportDetails.summary]);
  const summaryTopSkills = useMemo(() => parseSummaryPairs(reportDetails.summary["top_skills"]), [reportDetails.summary]);
  const summaryTopUnits = useMemo(() => parseTopUnits(reportDetails.summary["top_units"]), [reportDetails.summary]);

  const loadReport = useCallback(async (report: ReportRecord | null): Promise<void> => {
    const seq = ++reportLoadSeqRef.current;
    if (!report) { setSelectedReportPayload(null); setSelectedReportText(""); return; }
    setLoadingReport(true);
    try {
      const jp = getReportJsonPath(report), tp = getReportTextPath(report);
      const [jr, tr] = await Promise.allSettled([
        desktopRuntime && jp ? invoke<JsonRecord>("read_json_file", { path: jp }) : Promise.resolve<JsonRecord | null>(null),
        desktopRuntime && tp ? invoke<string>("read_text_file", { path: tp }) : Promise.resolve(""),
      ]);
      if (seq !== reportLoadSeqRef.current) return; // 已有更新的选择，丢弃本次结果
      const fb = buildReportFallbackPayload(report);
      setSelectedReportPayload(jr.status === "fulfilled" ? asRecord(jr.value) ?? fb : fb);
      setSelectedReportText(tr.status === "fulfilled" ? tr.value : "");
      if (jr.status === "rejected" && tr.status === "rejected") appendClientLog("error", `加载报告失败: ${formatErrorMessage(jr.reason)}`);
    } finally { if (seq === reportLoadSeqRef.current) setLoadingReport(false); }
  }, [appendClientLog, desktopRuntime]);

  useEffect(() => { if (!selectedSessionId && usefulSessions.length) setSelectedSessionId(usefulSessions[0].id); }, [selectedSessionId, usefulSessions]);
  useEffect(() => {
    if (focusedReportSessionId && reportsBySession.has(focusedReportSessionId)) return;
    const fb = liveReportSessionId || selectedSessionId || allReports[0]?.sessionId || "";
    if (fb !== focusedReportSessionId) setFocusedReportSessionId(fb);
  }, [allReports, focusedReportSessionId, liveReportSessionId, reportsBySession, selectedSessionId]);
  useEffect(() => {
    if (visibleReports.length === 0) { if (selectedReportId) setSelectedReportId(""); return; }
    if (!visibleReports.some((r) => reportKey(r) === selectedReportId)) setSelectedReportId(reportKey(visibleReports[0]));
  }, [selectedReportId, visibleReports]);
  useEffect(() => { void loadReport(selectedReport); }, [loadReport, selectedReport]);

  const resetReportFocus = useCallback(() => {
    setFocusedReportSessionId(""); setSelectedReportId("");
  }, []);
  const resetReportSelection = useCallback(() => {
    setSelectedSessionId(""); setFocusedReportSessionId(""); setSelectedReportId("");
    setSelectedReportPayload(null); setSelectedReportText("");
  }, []);

  return {
    currentReports, allReports, usefulSessions, emptySessions,
    selectedReport, selectedReportId, setSelectedReportId,
    selectedSessionId, setSelectedSessionId,
    focusedReportSessionId, setFocusedReportSessionId,
    visibleReports, visibleReportSessionId: visibleReports[0]?.sessionId ?? "",
    loadingReport, reportDetails, parsedBattleDetails,
    summaryEventTypes, summaryTopSkills, summaryTopUnits,
    resetReportFocus, resetReportSelection,
  };
}
