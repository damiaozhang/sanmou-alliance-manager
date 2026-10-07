// TODO(batch-ops): Wire in useSelection hook from @/hooks/useSelection for binding row selection.
// TODO(batch-ops): Render BatchActionBar from @/components/BatchActionBar when hasSelection is true.
//   Example actions: bulk status change (bind / pending / deactivated), bulk delete.
import React, { useState } from "react";
import { Link2 } from "lucide-react";
import type { AppBundle } from "../../tauri";
import { previewOrEmpty } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState } from "@/components/ErrorState";

export type BindingDraft = {
  avatarName: string;
  avatarId: string;
  confidence: string;
};

export const BindingTab = React.memo(function BindingTab({
  bundle,
  onSaveBinding,
  onAutoBind
}: {
  bundle: AppBundle | null;
  onSaveBinding: (request: BindingDraft) => Promise<boolean>;
  onAutoBind: () => Promise<number>;
}) {
  const bindings = previewOrEmpty(bundle?.memberBindings);
  const [bindingDraft, setBindingDraft] = useState<BindingDraft>({
    avatarName: "",
    avatarId: "",
    confidence: "已绑定"
  });
  const [errors, setErrors] = useState<{ avatarName?: string; avatarId?: string }>({});
  const [saving, setSaving] = useState(false);
  const [autoBinding, setAutoBinding] = useState(false);
  const [autoBindMessage, setAutoBindMessage] = useState<string | null>(null);

  function clearError(field: "avatarName" | "avatarId") {
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSave() {
    if (saving) return;
    const next: typeof errors = {};
    if (!bindingDraft.avatarName.trim()) next.avatarName = "请填写成员名称。";
    if (!bindingDraft.avatarId.trim()) next.avatarId = "请填写玩家 ID。";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    try {
      const saved = await onSaveBinding(bindingDraft);
      if (saved) {
        setBindingDraft({ avatarName: "", avatarId: "", confidence: "已绑定" });
      }
    } finally {
      setSaving(false);
    }
  }
  async function handleAutoBind() {
    if (autoBinding) return;
    setAutoBinding(true);
    setAutoBindMessage(null);
    try {
      const count = await onAutoBind();
      setAutoBindMessage(
        count > 0 ? `已从阵容统计自动绑定 ${count} 名成员。` : "没有可绑定的成员（需先采集战报生成阵容统计）。"
      );
    } finally {
      setAutoBinding(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {/* 自动绑定入口：战报采集同步时会自动写入「自动绑定」记录，这里提供手动触发 */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <div className="text-sm text-muted-foreground">
            战报采集页同步同盟战报时会按玩家阵容自动写入「自动绑定」记录；也可点击右侧按钮，从当前阵容统计立即批量绑定一次。
            {autoBindMessage && <p className="mt-1 text-caption text-foreground">{autoBindMessage}</p>}
          </div>
          <Button variant="outline" onClick={() => void handleAutoBind()} disabled={autoBinding}>
            <Link2 size={16} className="mr-2" />
            {autoBinding ? "绑定中…" : "从阵容统计自动绑定"}
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">成员名</label>
            <Input
              value={bindingDraft.avatarName}
              placeholder="成员名称"
              onChange={(event) => {
                setBindingDraft({ ...bindingDraft, avatarName: event.target.value });
                clearError("avatarName");
              }}
            />
            {errors.avatarName && <ErrorState message={errors.avatarName} />}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">玩家 ID</label>
            <Input
              value={bindingDraft.avatarId}
              placeholder="玩家 ID"
              onChange={(event) => {
                setBindingDraft({ ...bindingDraft, avatarId: event.target.value });
                clearError("avatarId");
              }}
            />
            {errors.avatarId && <ErrorState message={errors.avatarId} />}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">状态</label>
            <Select
              value={bindingDraft.confidence}
              onValueChange={(value) => setBindingDraft({ ...bindingDraft, confidence: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="已绑定">已绑定</SelectItem>
                <SelectItem value="待确认">待确认</SelectItem>
                <SelectItem value="已停用">已停用</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">写入后会保留绑定历史，最新一条会进入同盟时间对比。</p>
          <Button onClick={() => void handleSave()} disabled={saving}>
            <Link2 size={16} className="mr-2" />
            {saving ? "保存中…" : "保存绑定"}
          </Button>
        </div>

        {/* TODO(batch-ops): Add checkbox column for binding row selection, wired to useSelection.
            Render BatchActionBar when hasSelection with actions: bulk status change, bulk delete. */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>成员</TableHead>
              <TableHead>玩家 ID</TableHead>
              <TableHead>同盟</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bindings.map((item) => (
              <TableRow key={`${item.avatar}-${item.updated}`}>
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.avatar}</TableCell>
                <TableCell>{item.alliance}</TableCell>
                <TableCell>
                  <Badge variant={item.status === "已绑定" ? "success" : item.status === "待确认" ? "secondary" : "outline"}>
                    {item.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
});
