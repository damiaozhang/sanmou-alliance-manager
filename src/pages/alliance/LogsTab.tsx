import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TruncatedText } from "@/components/TruncatedText";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ROUTE_PATHS } from "@/app/routes";
import { useAllianceLogsPaged } from "@/app/queries";
import type { AllianceLogRow } from "@/tauri";
import {
  type AllianceLogSectionKey,
  allianceLogSections,
  allianceLogSectionLabel,
  formatAllianceLogActor
} from "@/features/alliance/logs";
import { cleanGameDisplayText } from "@/lib/format";
import { formatCaptureRecordTime } from "@/lib/dates";

const LOGS_PAGE_SIZE = 50;

/**
 * 阶段3b：同盟日志改走 get_alliance_logs_paged 服务端分页（section 过滤下推后端），
 * DataTable 虚拟化渲染；五分类计数用 limit=1 的 count 查询取 total（各查一次即缓存）。
 */
export function LogsTab({
  workspaceId,
  onCountChange
}: {
  workspaceId: number | null;
  onCountChange?: (total: number) => void;
}) {
  const navigate = useNavigate();
  const [logSection, setLogSection] = useState<AllianceLogSectionKey>("personnel");
  const [page, setPage] = useState(1);

  const logsQuery = useAllianceLogsPaged(workspaceId, logSection, {
    limit: LOGS_PAGE_SIZE,
    offset: (page - 1) * LOGS_PAGE_SIZE
  });

  // 五分类计数：每类一个 limit=1 查询，total 即该类全量条数（一次 reduce 汇总，替代旧多次 filter）
  const countQueries = {
    personnel: useAllianceLogsPaged(workspaceId, "personnel", { limit: 1, offset: 0 }),
    profession: useAllianceLogsPaged(workspaceId, "profession", { limit: 1, offset: 0 }),
    siege: useAllianceLogsPaged(workspaceId, "siege", { limit: 1, offset: 0 }),
    management: useAllianceLogsPaged(workspaceId, "management", { limit: 1, offset: 0 }),
    city: useAllianceLogsPaged(workspaceId, "city", { limit: 1, offset: 0 })
  };
  const logSectionCounts = useMemo(
    () =>
      allianceLogSections.reduce<Record<AllianceLogSectionKey, number>>(
        (counts, item) => {
          counts[item.key] = countQueries[item.key].data?.total ?? 0;
          return counts;
        },
        { personnel: 0, profession: 0, siege: 0, management: 0, city: 0 }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [countQueries.personnel.data, countQueries.profession.data, countQueries.siege.data, countQueries.management.data, countQueries.city.data]
  );

  // tab 计数上报（AllianceDataPage 的日志 tab 徽标）
  const currentTotal = logsQuery.data?.total ?? 0;
  useEffect(() => {
    onCountChange?.(currentTotal);
  }, [currentTotal, onCountChange]);

  const columns = useMemo<DataTableColumn<AllianceLogRow>[]>(
    () => [
      { key: "time", header: "时间", width: "180px", cellClassName: "whitespace-nowrap tabular-nums", render: (r) => formatCaptureRecordTime(r.time) },
      { key: "actor", header: "来源", width: "160px", render: (r) => formatAllianceLogActor(r.actor) },
      {
        key: "text",
        header: "内容",
        width: "minmax(320px,1fr)",
        // 日志正文可能很长：截断到两行 + 可展开，避免单条日志把整行高度撑到失控
        render: (r) => (
          <TruncatedText lines={2} expandable preserveLineBreaks>
            {cleanGameDisplayText(r.text) || r.text}
          </TruncatedText>
        )
      }
    ],
    []
  );

  return (
    <div className="space-y-4">
      <Tabs
        value={logSection}
        onValueChange={(v) => {
          setLogSection(v as AllianceLogSectionKey);
          setPage(1); // 分类切换后回第一页，避免 offset 越界
        }}
      >
        <TabsList>
          {allianceLogSections.map((section) => (
            <TabsTrigger key={section.key} value={section.key} className="gap-1.5">
              {section.label}
              <span className="text-[11px] font-normal tabular-nums text-muted-foreground">
                {logSectionCounts[section.key]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        rows={logsQuery.data?.rows ?? []}
        total={logsQuery.data?.total ?? 0}
        page={page}
        pageSize={LOGS_PAGE_SIZE}
        onPageChange={setPage}
        columns={columns}
        rowKey={(r, i) => `${r.captureSessionId}-${r.time}-${r.actor}-${i}`}
        emptyTitle={`当前工作区暂无${allianceLogSectionLabel(logSection)}日志。`}
        isPlaceholder={logsQuery.isPlaceholderData}
        maxHeight={560}
      />
      {(logsQuery.data?.total ?? 0) === 0 && !logsQuery.isLoading && (
        <button
          type="button"
          className="text-caption text-primary hover:underline"
          onClick={() => navigate(ROUTE_PATHS.capture)}
        >
          去采集中心
        </button>
      )}
    </div>
  );
}
