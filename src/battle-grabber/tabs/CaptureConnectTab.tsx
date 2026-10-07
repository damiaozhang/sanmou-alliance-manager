import { useMemo } from "react";
import { Activity, FileText, FolderOpen, Link2, Radio, RefreshCcw, Search, Unplug } from "lucide-react";

import type { AppSnapshot, CaptureMode, ProcessInfo, ScanWorkspaceRecord } from "../types";
import { VISIBLE_CAPTURE_LOG_LIMIT, VISIBLE_CAPTURE_PACKET_LIMIT } from "../constants";
import { formatCount, formatTime } from "../utils/format";
import { CollapsibleCard } from "../components/ui/CollapsibleCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function formatWorkspaceName(v: string): string {
  return v || "默认 output";
}

function encodeSelectValue(scope: string, value: string): string {
  return `${scope}:${encodeURIComponent(value)}`;
}

function decodeSelectValue(scope: string, value: string): string {
  const prefix = `${scope}:`;
  if (!value.startsWith(prefix)) return value;
  try {
    return decodeURIComponent(value.slice(prefix.length));
  } catch {
    return value.slice(prefix.length);
  }
}

function workspaceSelectValue(value: string): string {
  return encodeSelectValue("workspace", value.trim());
}

function workspaceFromSelectValue(value: string): string {
  return decodeSelectValue("workspace", value);
}

function processSelectValue(value: string): string {
  return encodeSelectValue("process", value.trim());
}

function processFromSelectValue(value: string): string {
  return decodeSelectValue("process", value);
}

export type CaptureConnectTabProps = {
  snapshot: AppSnapshot;
  workspaceDraft: string;
  setWorkspaceDraft: (v: string) => void;
  workspaces: ScanWorkspaceRecord[];
  selectedProcess: string;
  setSelectedProcess: (v: string) => void;
  captureMode: CaptureMode;
  setCaptureMode: (m: CaptureMode) => void;
  busy: boolean;
  connectionReady: boolean;
  processes: ProcessInfo[];
  workspaceSwitchDisabled: boolean;
  workspaceChanged: boolean;
  applyScanWorkspaceSetting: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  refreshProcesses: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

export function CaptureConnectTab(props: CaptureConnectTabProps): JSX.Element {
  const {
    snapshot, workspaceDraft, setWorkspaceDraft, workspaces, selectedProcess, setSelectedProcess,
    captureMode, setCaptureMode, busy, connectionReady, processes,
    workspaceSwitchDisabled, workspaceChanged,
    applyScanWorkspaceSetting, refreshWorkspaces, refreshProcesses, connect, disconnect,
  } = props;

  const visibleCapturePackets = useMemo(() => snapshot.packets.slice(-VISIBLE_CAPTURE_PACKET_LIMIT).reverse(), [snapshot.packets]);
  const visibleCaptureLogs = useMemo(() => snapshot.logs.slice(-VISIBLE_CAPTURE_LOG_LIMIT), [snapshot.logs]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="space-y-4">
        <CollapsibleCard title="第一步采集设置" icon={FolderOpen}>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="space-y-2">
              <span className="text-caption text-muted-foreground">采集输出目录</span>
              <Input value={workspaceDraft} onChange={(e) => setWorkspaceDraft(e.target.value)} placeholder="0609" disabled={workspaceSwitchDisabled} />
            </label>
            <div className="flex items-end"><Button variant="outline" onClick={() => void applyScanWorkspaceSetting()} disabled={workspaceSwitchDisabled || !workspaceChanged}><RefreshCcw className="mr-2 h-4 w-4" />{busy ? "应用中..." : "应用目录"}</Button></div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="space-y-2">
              <span className="text-caption text-muted-foreground">历史目录</span>
              <Select value={workspaceSelectValue(workspaceDraft)} onValueChange={(v) => setWorkspaceDraft(workspaceFromSelectValue(v))} disabled={workspaceSwitchDisabled || workspaces.length === 0}>
                <SelectTrigger><SelectValue placeholder="暂无目录记录" /></SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => <SelectItem key={w.name || "__default"} value={workspaceSelectValue(w.name)}>{formatWorkspaceName(w.name)}{w.active ? " · 当前" : ""}{w.sessionCount > 0 ? ` · ${w.sessionCount} 会话` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <div className="flex items-end"><Button variant="outline" onClick={() => void refreshWorkspaces()} disabled={workspaceSwitchDisabled}><RefreshCcw className="mr-2 h-4 w-4" />刷新</Button></div>
          </div>
          <div className="mt-3 grid gap-2 text-caption text-muted-foreground md:grid-cols-2">
            <p>当前：{snapshot.scanWorkspace || "默认 output"}</p>
            <p className="truncate">目录：{snapshot.workspaceOutputDir || "-"}</p>
          </div>
          <p className="mt-2 text-caption text-muted-foreground">
            提示：采集输出目录是战报文件的存放位置，与顶栏选择的「数据工作区」相互独立。
          </p>
        </CollapsibleCard>
        <CollapsibleCard title="第二步连接游戏" icon={Link2}>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="space-y-2">
              <span className="text-caption text-muted-foreground">游戏进程</span>
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Select value={selectedProcess ? processSelectValue(selectedProcess) : ""} onValueChange={(v) => setSelectedProcess(processFromSelectValue(v))}>
                  <SelectTrigger><SelectValue placeholder="选择进程..." /></SelectTrigger>
                  <SelectContent>
                    {processes.filter((p) => p.name.trim()).map((p) => <SelectItem key={`${p.name}:${p.pid}`} value={processSelectValue(p.name)}>{p.name} ({p.pid})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </label>
            <Button variant={captureMode === "passive" ? "default" : "outline"} onClick={() => setCaptureMode("passive")}>被动采集</Button>
            <Button variant={captureMode === "legacy" ? "default" : "outline"} onClick={() => setCaptureMode("legacy")}>兼容模式</Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void refreshProcesses()}><RefreshCcw className="mr-2 h-4 w-4" />刷新进程</Button>
            {connectionReady
              ? <Button variant="destructive" onClick={() => void disconnect()} disabled={busy}><Unplug className="mr-2 h-4 w-4" />断开</Button>
              : <Button onClick={() => void connect()} disabled={busy || !selectedProcess}><Radio className="mr-2 h-4 w-4" />{busy ? "启动中..." : "连接"}</Button>}
          </div>
        </CollapsibleCard>
        <CollapsibleCard title="抓取记录" icon={Activity}>
          <Table>
            <TableHeader>
              <TableRow><TableHead className="w-[50px]">#</TableHead><TableHead>Msg</TableHead><TableHead>协议</TableHead><TableHead>大小</TableHead><TableHead>时间</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.packets.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">{connectionReady ? "等待协议数据..." : "连接后会在这里显示网络抓取结果"}</TableCell></TableRow>}
              {visibleCapturePackets.map((p) => (
                <TableRow key={`${p.sessionId}:${p.seq}`}>
                  <TableCell>{p.seq}</TableCell>
                  <TableCell className="text-info">{p.msgId}</TableCell>
                  <TableCell className="truncate max-w-[200px]">{p.protoName}</TableCell>
                  <TableCell>{formatCount(p.contentLength)} B</TableCell>
                  <TableCell className="text-muted-foreground">{formatTime(p.timestamp)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CollapsibleCard>
      </section>
      <CollapsibleCard title="运行日志" icon={FileText}>
        <div className="h-[680px] overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-6">
          {snapshot.logs.length === 0 && <p className="text-muted-foreground">暂无日志。启动连接、监听或报告加载后会持续写入。</p>}
          {visibleCaptureLogs.map((e, i) => (
            <div key={`${e.timestamp}-${i}`} className={e.level === "error" ? "text-destructive" : e.level === "warn" ? "text-warning" : "text-foreground"}>
              <span className="text-muted-foreground">[{e.timestamp}]</span> {e.message}
            </div>
          ))}
        </div>
      </CollapsibleCard>
    </div>
  );
}
