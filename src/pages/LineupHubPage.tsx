import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpenCheck, ShieldEllipsis, Swords, Target } from "lucide-react";
import type { LineupDraft } from "@/features/lineup/types";
import { useAppData } from "@/app/queries";
import { useActiveWorkspaceContext } from "@/features/workspace/useActiveWorkspaceContext";
import { useSaveLineupProfile } from "@/features/lineup/useSaveLineupProfile";
import { useExportActions } from "@/features/export/useExportActions";
import { useTabUrl } from "@/hooks/useTabUrl";
import { useUrlState } from "@/hooks/useUrlState";
import { ExportMenu } from "@/components/ExportMenu";
import { PageShell } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AutoLineupTab } from "./lineup/AutoLineupTab";
import { ManualLineupTab } from "./lineup/ManualLineupTab";
import { MatchupTab } from "./lineup/MatchupTab";
import { WinRateTab } from "./lineup/WinRateTab";

type LineupTabKey = "auto" | "manual" | "matchup" | "winrate";

export const LineupHubPage = React.memo(function LineupHubPage() {
  // 阶段4：页面自取数据与动作，不再接收 App 下钻 props
  const { workspaceId, allianceId } = useActiveWorkspaceContext();
  const { bundle, lineupAnalysis } = useAppData(workspaceId);
  const { saveLineupProfile: onSaveLineup } = useSaveLineupProfile(allianceId);
  const { exportActions } = useExportActions();
  const onExportJson = exportActions.lineupJson;
  const onExportCsv = exportActions.lineupCsv;
  const onExportHtml = exportActions.lineupHtml;
  const navigate = useNavigate();
  const onPlayerClick = useCallback((avatarId: string) => navigate(`/player/${avatarId}`), [navigate]);
  const [activeTab, setActiveTab] = useTabUrl<LineupTabKey>("tab", "auto");
  const [query, setQuery] = useUrlState("q");
  const [exportBusy, setExportBusy] = useState(false);
  const [draft, setDraft] = useState<LineupDraft>({
    playerName: "",
    playerAvatarId: "",
    label: "",
    heroes: "",
    confidence: "用户确认",
    notes: "",
    sourceBattleId: "",
  });

  // 胜率矩阵不带 count：矩阵维度不是列表计数
  const tabs: Array<{ key: LineupTabKey; label: string; icon: typeof ShieldEllipsis; count?: number }> = [
    { key: "auto", label: "自动阵容", icon: ShieldEllipsis, count: lineupAnalysis.stats.length },
    { key: "manual", label: "手动记录", icon: BookOpenCheck, count: (bundle?.lineupProfiles ?? []).length },
    { key: "matchup", label: "对阵分析", icon: Swords, count: lineupAnalysis.matchups.length },
    { key: "winrate", label: "胜率矩阵", icon: Target },
  ];

  async function runExport(action: () => void) {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      await Promise.resolve(action());
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <PageShell
      title="阵容中心"
      description="从自动识别到克制分析，在一个工作台中完成阵容研判。"
      actions={
        <ExportMenu
          items={[
            { label: "JSON", onSelect: () => runExport(onExportJson) },
            { label: "CSV", onSelect: () => runExport(onExportCsv) },
            { label: "HTML", onSelect: () => runExport(onExportHtml) },
          ]}
          busy={exportBusy}
        />
      }
    >
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as LineupTabKey)}>
        <TabsList className="w-full justify-start border-b border-border bg-transparent p-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                className="gap-1.5 rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <Icon size={14} />
                {tab.label}
                {tab.count !== undefined && (
                  <Badge variant="secondary" className="ml-1">
                    {tab.count}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {activeTab === "auto" && (
        <AutoLineupTab stats={lineupAnalysis.stats} query={query} setQuery={setQuery} onPlayerClick={onPlayerClick} />
      )}
      {activeTab === "manual" && (
        <ManualLineupTab
          bundle={bundle}
          draft={draft}
          setDraft={setDraft}
          query={query}
          setQuery={setQuery}
          onSaveLineup={onSaveLineup}
        />
      )}
      {activeTab === "matchup" && <MatchupTab matchups={lineupAnalysis.matchups} query={query} setQuery={setQuery} />}
      {activeTab === "winrate" && <WinRateTab lineupAnalysis={lineupAnalysis} />}
    </PageShell>
  );
});
