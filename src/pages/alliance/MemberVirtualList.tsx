import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SortIndicator } from "@/components/SortIndicator";
import { TruncatedText } from "@/components/TruncatedText";
import { cn } from "@/lib/utils";
import {
  type AllianceDisplayMember,
  type MemberSortKey,
  isAllianceMemberOnline,
  formatWeeklyStatistics,
} from "@/features/alliance/members";
import type { SortState } from "@/lib/sort";
import { formatUnixSeconds } from "@/lib/dates";

/**
 * 成员虚拟列表（2026-09-21 精度重做）。
 *
 * 15 列 × 固定列宽的自绘 grid 表，密度是这里的关键：行高 40 → 34px、表头 40 → 32px、
 * 字号 14 → 12.5px，一屏能多出约 1/3 的行。同时补齐三处精度：
 * 1. 数字列改为**右对齐**（千分位数字左对齐时位数无法纵向比较）；
 * 2. 长文本列走 `TruncatedText`，悬停可见全文（原实现只有 truncate，看不到被截掉的内容）；
 * 3. 可排序列的表头改为**满高点击区** + hover 底色，点哪儿都能排序。
 *
 * 注意：`MEMBER_ROW_HEIGHT` 必须与行 CSS 高度严格一致，否则虚拟滚动会错位。
 */
const MEMBER_ROW_HEIGHT = 34;
const MEMBER_TABLE_MIN_WIDTH = 1680;
const MEMBER_GRID_COLUMNS = "118px 150px 88px 96px 72px 152px 96px 96px 96px 112px 120px 150px 132px 120px 132px";

/** 空值统一用破折号（设计基调 §4：无数据不显示 0，也不用裸 "-"） */
const EMPTY = "—";

function SortableHead({
  label,
  sortKey,
  memberSort,
  onToggle,
  align = "left",
}: {
  label: string;
  sortKey: MemberSortKey;
  memberSort: SortState<MemberSortKey>;
  onToggle: (key: MemberSortKey) => void;
  align?: "left" | "right";
}) {
  const active = memberSort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={cn(
        "flex h-full w-full items-center gap-1 px-2.5 transition-colors",
        "hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
        align === "right" ? "flex-row-reverse justify-start" : "justify-start",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      <SortIndicator active={active} direction={memberSort.direction} />
    </button>
  );
}

function HeadCell({ children }: { children: React.ReactNode }) {
  return (
    <div role="columnheader" className="flex h-full items-center px-2.5">
      {children}
    </div>
  );
}

export function MemberVirtualList({
  members,
  onPlayerClick,
  memberSort,
  toggleMemberSort,
  selectedMemberKey,
  onSelectMember,
}: {
  members: AllianceDisplayMember[];
  onPlayerClick?: (avatarId: string) => void;
  memberSort: SortState<MemberSortKey>;
  toggleMemberSort: (key: MemberSortKey) => void;
  selectedMemberKey?: string | null;
  onSelectMember?: (member: AllianceDisplayMember) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const gridStyle = { gridTemplateColumns: MEMBER_GRID_COLUMNS };

  const virtualizer = useVirtualizer({
    count: members.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => MEMBER_ROW_HEIGHT,
    overscan: 12,
  });

  return (
    <div className="overflow-hidden rounded-lg border border-border" role="table" aria-label="成员列表">
      <div
        ref={parentRef}
        className="min-h-[420px] max-h-[calc(100vh-286px)] overflow-auto"
        style={{ scrollbarGutter: "stable both-edges" }}
        role="presentation"
      >
        <div style={{ minWidth: MEMBER_TABLE_MIN_WIDTH }} role="presentation">
          {/* 吸顶表头：bg 用不透明色，避免滚动时透出下方行内容 */}
          <div
            className="sticky top-0 z-10 grid h-8 border-b border-border bg-muted text-[11px] font-medium tracking-wide"
            style={gridStyle}
            role="row"
          >
            <HeadCell>玩家 ID</HeadCell>
            <HeadCell>成员</HeadCell>
            <HeadCell>职业</HeadCell>
            <HeadCell>分组</HeadCell>
            <HeadCell>在线</HeadCell>
            <div role="columnheader" className="h-full">
              <SortableHead label="离线" sortKey="lastOfflineTs" memberSort={memberSort} onToggle={toggleMemberSort} />
            </div>
            <div role="columnheader" className="h-full">
              <SortableHead
                label="繁荣度"
                sortKey="prosperity"
                memberSort={memberSort}
                onToggle={toggleMemberSort}
                align="right"
              />
            </div>
            <div role="columnheader" className="h-full">
              <SortableHead
                label="贡献"
                sortKey="contribution"
                memberSort={memberSort}
                onToggle={toggleMemberSort}
                align="right"
              />
            </div>
            <div role="columnheader" className="h-full">
              <SortableHead
                label="武勋"
                sortKey="merit"
                memberSort={memberSort}
                onToggle={toggleMemberSort}
                align="right"
              />
            </div>
            <div role="columnheader" className="h-full">
              <SortableHead
                label="赛季积分"
                sortKey="seasonScore"
                memberSort={memberSort}
                onToggle={toggleMemberSort}
                align="right"
              />
            </div>
            <div role="columnheader" className="h-full">
              <SortableHead
                label="今日武勋"
                sortKey="tFeat"
                memberSort={memberSort}
                onToggle={toggleMemberSort}
                align="right"
              />
            </div>
            <HeadCell>入盟</HeadCell>
            <HeadCell>周明细</HeadCell>
            <HeadCell>攻城/拆迁</HeadCell>
            <HeadCell>坐标</HeadCell>
          </div>
          <div role="rowgroup">
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
              role="presentation"
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const member = members[virtualRow.index];
                const memberKey = member.avatarId || `${member.name}-${member.coord}`;
                const selected = selectedMemberKey === memberKey;
                return (
                  <div
                    key={memberKey}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      ...gridStyle,
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className={cn(
                      "grid h-[34px] cursor-default items-center border-b border-border/70 text-[12.5px] transition-colors last:border-b-0",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
                      selected ? "bg-primary/[0.08] shadow-[inset_2px_0_0_hsl(var(--primary))]" : "hover:bg-muted/50",
                    )}
                    role="row"
                    tabIndex={0}
                    aria-selected={selected}
                    onClick={() => onSelectMember?.(member)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectMember?.(member);
                      }
                    }}
                  >
                    <div role="cell" className="px-2.5 font-mono text-[11.5px] tabular-nums text-muted-foreground">
                      <TruncatedText>{member.avatarId || EMPTY}</TruncatedText>
                    </div>
                    <div role="cell" className="min-w-0 px-2.5">
                      {member.avatarId && onPlayerClick ? (
                        <Button
                          variant="link"
                          className="h-auto max-w-full justify-start p-0 text-left text-[12.5px]"
                          onClick={(event) => {
                            event.stopPropagation();
                            onPlayerClick(member.avatarId!);
                          }}
                          title={member.name}
                        >
                          <span className="truncate">{member.name}</span>
                        </Button>
                      ) : (
                        <TruncatedText>{member.name}</TruncatedText>
                      )}
                    </div>
                    <div role="cell" className="px-2.5">
                      <TruncatedText className="text-muted-foreground">{member.profession || EMPTY}</TruncatedText>
                    </div>
                    <div role="cell" className="px-2.5">
                      <TruncatedText>{member.legion || EMPTY}</TruncatedText>
                    </div>
                    <div role="cell" className="px-2.5">
                      <Badge variant={isAllianceMemberOnline(member) ? "success" : "secondary"}>
                        {isAllianceMemberOnline(member) ? "在线" : "离线"}
                      </Badge>
                    </div>
                    <div role="cell" className="px-2.5 text-[12px] tabular-nums text-muted-foreground">
                      {formatUnixSeconds(member.lastOfflineTs)}
                    </div>
                    <div role="cell" className="px-2.5 text-right tabular-nums">
                      {(member.prosperity ?? 0).toLocaleString("zh-CN")}
                    </div>
                    <div role="cell" className="px-2.5 text-right font-medium tabular-nums">
                      {member.contribution.toLocaleString("zh-CN")}
                    </div>
                    <div role="cell" className="px-2.5 text-right tabular-nums">
                      {member.merit.toLocaleString("zh-CN")}
                    </div>
                    <div role="cell" className="px-2.5 text-right tabular-nums">
                      {(member.seasonScore ?? 0).toLocaleString("zh-CN")}
                    </div>
                    <div role="cell" className="px-2.5 text-right tabular-nums">
                      {(member.tFeat ?? 0).toLocaleString("zh-CN")}
                    </div>
                    <div role="cell" className="px-2.5 text-[12px] tabular-nums text-muted-foreground">
                      {formatUnixSeconds(member.joinTs)}
                    </div>
                    <div role="cell" className="px-2.5 text-muted-foreground">
                      <TruncatedText>{formatWeeklyStatistics(member.weeklyStatisticsJson)}</TruncatedText>
                    </div>
                    <div role="cell" className="px-2.5 text-right tabular-nums">
                      {member.demolition}
                    </div>
                    <div role="cell" className="px-2.5 font-mono text-[11.5px] tabular-nums text-muted-foreground">
                      {member.coord}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
