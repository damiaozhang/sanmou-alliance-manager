import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { FilterBar, FilterChip, FilterDivider } from "@/components/FilterBar";
import { useToggleSort } from "@/hooks/useToggleSort";
import { ROUTE_PATHS } from "@/app/routes";
import { type AllianceDisplayMember, type MemberSortKey, memberSortValue } from "@/features/alliance/members";
import { sortRows } from "@/lib/sort";
import { ALLIANCE_SCANNING_EMPTY } from "@/lib/labels";
import { MemberVirtualList } from "./MemberVirtualList";
import { MemberInspector } from "./MemberInspector";

type FilterOption = { value: string; label: string };

/**
 * 成员列表（2026-09-21 精度重做）。
 *
 * 筛选条改为统一的 FilterBar + FilterChip：
 * - 在线状态只有 3 个取值，用 chip 表达比三个下拉更快，且**当前选中项一眼可见**；
 * - 职业/军团取值多，保留下拉，但宽度与高度收进工具栏一档；
 * - 右侧固定显示「已筛选 N / M 人」+ 清除。这是本轮要解决的直接问题：
 *   此前筛选 state 是页面级的，切到别的 tab 仍会过滤数据，但筛选条只在成员 tab 渲染，
 *   用户看到被过滤的结果却找不到原因。
 */
export function MembersTab({
  members,
  onPlayerClick,
  legionFilter,
  setLegionFilter,
  professionFilter,
  setProfessionFilter,
  onlineFilter,
  setOnlineFilter,
  legionOptions,
  professionOptions,
  allianceCaptureRunning,
  totalCount,
}: {
  members: AllianceDisplayMember[];
  onPlayerClick?: (avatarId: string) => void;
  legionFilter: string;
  setLegionFilter: (v: string) => void;
  professionFilter: string;
  setProfessionFilter: (v: string) => void;
  onlineFilter: string;
  setOnlineFilter: (v: string) => void;
  legionOptions: FilterOption[];
  professionOptions: FilterOption[];
  allianceCaptureRunning: boolean;
  /** 未筛选时的成员总数，用于「N / M」表达 */
  totalCount: number;
}) {
  const navigate = useNavigate();
  const { sort: memberSort, toggle: toggleMemberSort } = useToggleSort<MemberSortKey>({
    key: "contribution",
    direction: "desc",
  });
  const sortedMembers = useMemo(() => sortRows(members, memberSort, memberSortValue), [members, memberSort]);
  const [selectedMemberKey, setSelectedMemberKey] = useState<string | null>(null);
  const selectedMember = useMemo(
    () =>
      sortedMembers.find((member) => (member.avatarId || `${member.name}-${member.coord}`) === selectedMemberKey) ??
      null,
    [selectedMemberKey, sortedMembers],
  );

  const hasFilter =
    Boolean(professionFilter) || Boolean(legionFilter) || (Boolean(onlineFilter) && onlineFilter !== "all");

  function clearFilters() {
    setProfessionFilter("");
    setLegionFilter("");
    setOnlineFilter("all");
  }

  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1 space-y-3">
        <FilterBar
          summary={hasFilter ? `${sortedMembers.length} / ${totalCount} 人` : `共 ${totalCount} 人`}
          onClear={hasFilter ? clearFilters : undefined}
        >
          <FilterChip active={!onlineFilter || onlineFilter === "all"} onClick={() => setOnlineFilter("all")}>
            全部
          </FilterChip>
          <FilterChip active={onlineFilter === "online"} onClick={() => setOnlineFilter("online")}>
            在线
          </FilterChip>
          <FilterChip active={onlineFilter === "offline"} onClick={() => setOnlineFilter("offline")}>
            离线
          </FilterChip>
          <FilterDivider />
          <Select
            value={professionFilter || "__all__"}
            onValueChange={(v) => setProfessionFilter(v === "__all__" ? "" : v)}
          >
            <SelectTrigger
              className="h-6 w-[128px] border-border bg-card text-[11.5px] text-muted-foreground"
              aria-label="按职业筛选"
            >
              <SelectValue placeholder="全部职业" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部职业</SelectItem>
              {professionOptions
                .filter((profession) => profession.value)
                .map((profession) => (
                  <SelectItem value={profession.value} key={profession.value}>
                    {profession.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={legionFilter || "__all__"} onValueChange={(v) => setLegionFilter(v === "__all__" ? "" : v)}>
            <SelectTrigger
              className="h-6 w-[128px] border-border bg-card text-[11.5px] text-muted-foreground"
              aria-label="按军团分组筛选"
            >
              <SelectValue placeholder="全部分组" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部分组</SelectItem>
              {legionOptions
                .filter((legion) => legion.value)
                .map((legion) => (
                  <SelectItem value={legion.value} key={legion.value}>
                    {legion.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </FilterBar>

        {sortedMembers.length === 0 ? (
          <EmptyState
            title={
              allianceCaptureRunning
                ? ALLIANCE_SCANNING_EMPTY
                : hasFilter
                  ? "当前筛选条件下没有成员"
                  : "当前工作区暂无同盟成员快照。"
            }
            action={
              allianceCaptureRunning
                ? undefined
                : hasFilter
                  ? { label: "清除筛选", onClick: clearFilters }
                  : { label: "去采集中心", onClick: () => navigate(ROUTE_PATHS.capture) }
            }
          />
        ) : (
          <MemberVirtualList
            members={sortedMembers}
            onPlayerClick={onPlayerClick}
            memberSort={memberSort}
            toggleMemberSort={toggleMemberSort}
            selectedMemberKey={selectedMemberKey}
            onSelectMember={(member) => setSelectedMemberKey(member.avatarId || `${member.name}-${member.coord}`)}
          />
        )}
      </div>
      {selectedMember ? (
        <MemberInspector
          member={selectedMember}
          onClose={() => setSelectedMemberKey(null)}
          onOpenProfile={onPlayerClick}
        />
      ) : null}
    </div>
  );
}
