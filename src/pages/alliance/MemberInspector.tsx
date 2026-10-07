import { useEffect, useRef } from "react";
import { Activity, ExternalLink, Hammer, MapPin, Shield, Trophy, Wheat, X } from "lucide-react";
import type { AllianceDisplayMember } from "@/features/alliance/members";
import { formatWeeklyStatistics, isAllianceMemberOnline } from "@/features/alliance/members";
import { formatUnixSeconds } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function MemberInspector({
  member,
  onClose,
  onOpenProfile,
}: {
  member: AllianceDisplayMember;
  onClose: () => void;
  onOpenProfile?: (avatarId: string) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [member.avatarId, onClose]);

  const online = isAllianceMemberOnline(member);
  const weekly = formatWeeklyStatistics(member.weeklyStatisticsJson);

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label={`${member.name} 成员详情`}
      className="member-inspector sticky top-0 w-[318px] shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-card focus:outline-none"
    >
      <div className="flex items-start gap-3 border-b border-border px-4 py-3.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-[13px] font-semibold text-brand-soft-foreground">
          {member.name.slice(0, 1) || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold">{member.name}</h3>
            <Badge variant={online ? "success" : "secondary"}>{online ? "在线" : "离线"}</Badge>
          </div>
          <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
            {member.avatarId || "无玩家 ID"}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="关闭成员详情" title="关闭（Esc）" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-border border-b border-border">
        <Metric label="贡献" value={member.contribution} tone="text-primary" />
        <Metric label="武勋" value={member.merit} tone="text-victory" />
        <Metric label="繁荣度" value={member.prosperity} />
        <Metric label="赛季积分" value={member.seasonScore} />
      </div>

      <div className="space-y-0 px-4 py-2">
        <Detail
          icon={Shield}
          label="职业 / 官职"
          value={[member.profession, member.official].filter(Boolean).join(" · ") || "未设置"}
        />
        <Detail icon={Activity} label="军团分组" value={member.legion || "未分配"} />
        <Detail icon={MapPin} label="坐标" value={member.coord || "未记录"} mono />
        <Detail icon={Trophy} label="今日武勋" value={member.tFeat.toLocaleString("zh-CN")} />
        <Detail icon={Wheat} label="今日辎重" value={member.tForageUse.toLocaleString("zh-CN")} />
        <Detail icon={Hammer} label="攻城 / 拆迁" value={member.demolition.toLocaleString("zh-CN")} />
      </div>

      <div className="border-t border-border px-4 py-3">
        <p className="text-[10.5px] tracking-wide text-muted-foreground">活动记录</p>
        <dl className="mt-2 grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5 text-[11.5px]">
          <dt className="text-muted-foreground">最近离线</dt>
          <dd className="truncate tabular-nums">{formatUnixSeconds(member.lastOfflineTs)}</dd>
          <dt className="text-muted-foreground">入盟时间</dt>
          <dd className="truncate tabular-nums">{formatUnixSeconds(member.joinTs)}</dd>
          <dt className="text-muted-foreground">周维度</dt>
          <dd className="truncate" title={weekly}>
            {weekly || "暂无周数据"}
          </dd>
        </dl>
      </div>

      {member.avatarId && onOpenProfile ? (
        <div className="border-t border-border p-3">
          <Button variant="outline" className="w-full" onClick={() => onOpenProfile(member.avatarId)}>
            <ExternalLink size={13} />
            打开完整玩家档案
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="px-3 py-2.5">
      <dt className="text-[10.5px] text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-[16px] font-semibold tabular-nums ${tone ?? ""}`}>
        {value > 0 ? value.toLocaleString("zh-CN") : "—"}
      </dd>
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: typeof Shield;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border/70 py-2 last:border-b-0">
      <Icon size={13} className="shrink-0 text-muted-foreground" />
      <span className="w-[74px] shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-right text-[11.5px] ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </span>
    </div>
  );
}
