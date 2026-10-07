import { useMemo, useState } from "react";
import { BookOpenCheck } from "lucide-react";
import type { AppBundle } from "../../tauri";
import type { LineupDraft } from "@/features/lineup/types";
import { previewOrEmpty } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SearchInput } from "@/components/SearchInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ManualLineupTab({
  bundle, draft, setDraft, query, setQuery, onSaveLineup
}: {
  bundle: AppBundle | null;
  draft: LineupDraft;
  setDraft: (d: LineupDraft) => void;
  query: string;
  setQuery: (v: string) => void;
  onSaveLineup: (request: LineupDraft) => Promise<boolean>;
}) {
  const lineups = previewOrEmpty(bundle?.lineupProfiles);
  const [errors, setErrors] = useState<{ playerName?: string; label?: string; heroes?: string }>({});
  const [saving, setSaving] = useState(false);

  function clearError(field: "playerName" | "label" | "heroes") {
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSave() {
    if (saving) return;
    const next: typeof errors = {};
    if (!draft.playerName.trim()) next.playerName = "请填写对手玩家名称。";
    if (!draft.label.trim()) next.label = "请填写阵容标签。";
    const heroes = draft.heroes.split(/[/／]/).map((h) => h.trim()).filter(Boolean);
    if (heroes.length === 0) next.heroes = "请按「张辽 / 曹操 / 典韦」格式填写至少 1 名英雄。";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    try {
      const saved = await onSaveLineup(draft);
      if (saved) {
        setDraft({ playerName: "", playerAvatarId: "", label: "", heroes: "", confidence: "用户确认", notes: "", sourceBattleId: "" });
      }
    } finally {
      setSaving(false);
    }
  }
  const filtered = useMemo(() => {
    if (!query.trim()) return lineups;
    const q = query.trim().toLowerCase();
    return lineups.filter((l) => {
      const haystack = `${l.label} ${l.player} ${l.heroes} ${l.source} ${l.confidence}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [lineups, query]);

  return (
    <>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">对手玩家</label>
              <Input
                value={draft.playerName}
                placeholder="对手玩家名称"
                onChange={(e) => {
                  setDraft({ ...draft, playerName: e.target.value });
                  clearError("playerName");
                }}
              />
              {errors.playerName && <ErrorState message={errors.playerName} />}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">玩家 ID</label>
              <Input value={draft.playerAvatarId} placeholder="可选" onChange={(e) => setDraft({ ...draft, playerAvatarId: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">阵容标签</label>
              <Input
                value={draft.label}
                placeholder="固定阵容名称"
                onChange={(e) => {
                  setDraft({ ...draft, label: e.target.value });
                  clearError("label");
                }}
              />
              {errors.label && <ErrorState message={errors.label} />}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">英雄阵容</label>
              <Input
                value={draft.heroes}
                placeholder="张辽 / 曹操 / 典韦"
                onChange={(e) => {
                  setDraft({ ...draft, heroes: e.target.value });
                  clearError("heroes");
                }}
              />
              {errors.heroes && <ErrorState message={errors.heroes} />}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">来源战报码</label>
              <Input value={draft.sourceBattleId} placeholder="可选" onChange={(e) => setDraft({ ...draft, sourceBattleId: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">置信度</label>
              <Select value={draft.confidence} onValueChange={(v) => setDraft({ ...draft, confidence: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="用户确认">用户确认</SelectItem>
                  <SelectItem value="候选阵容">候选阵容</SelectItem>
                  <SelectItem value="待确认">待确认</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2 lg:col-span-3">
              <label className="text-sm font-medium">备注</label>
              <Input value={draft.notes} placeholder="可选" onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">手动记录用于补充采集不到的阵容观察。</p>
            <Button onClick={() => void handleSave()} disabled={saving}>
              <BookOpenCheck size={16} className="mr-2" />
              {saving ? "保存中…" : "保存阵容"}
            </Button>
          </div>
          <Separator />
          <SearchInput value={query} placeholder="搜索阵容、玩家、来源" onChange={setQuery} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((lineup) => (
              <Card key={`${lineup.label}-${lineup.player}-${lineup.source}`}>
                <CardContent className="pt-6 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={lineup.confidence === "用户确认" ? "success" : lineup.confidence === "候选阵容" ? "secondary" : "outline"}>
                      {lineup.confidence}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{lineup.source}</span>
                  </div>
                  <p className="font-semibold">{lineup.label}</p>
                  <p className="text-sm">{lineup.player}</p>
                  <p className="text-caption text-muted-foreground">{lineup.heroes}</p>
                </CardContent>
              </Card>
            ))}
            {filtered.length === 0 && <EmptyState title="没有匹配的手动阵容记录。" />}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
