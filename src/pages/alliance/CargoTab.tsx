import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { SortIndicator } from "@/components/SortIndicator";
import { useToggleSort } from "@/hooks/useToggleSort";
import { ROUTE_PATHS } from "@/app/routes";
import {
  type AllianceDisplayMember,
  type CargoSortKey,
  cargoSortValue
} from "@/features/alliance/members";
import { sortRows } from "@/lib/sort";
import { formatAllianceCargoRatio } from "@/lib/format";
import { ALLIANCE_SCANNING_EMPTY } from "@/lib/labels";

export function CargoTab({
  members,
  allianceCaptureRunning
}: {
  members: AllianceDisplayMember[];
  allianceCaptureRunning: boolean;
}) {
  const navigate = useNavigate();
  const { sort: cargoSort, toggle: toggleCargoSort } = useToggleSort<CargoSortKey>({
    key: "cargoRatio",
    direction: "desc"
  });
  const cargoMembers = useMemo(() => sortRows(members, cargoSort, cargoSortValue), [members, cargoSort]);

  return cargoMembers.length === 0 ? (
    <EmptyState
      title={
        allianceCaptureRunning
          ? ALLIANCE_SCANNING_EMPTY
          : "当前工作区暂无辎重数据。"
      }
      action={allianceCaptureRunning ? undefined : { label: "去采集中心", onClick: () => navigate(ROUTE_PATHS.capture) }}
    />
  ) : (
    <>
      {/* TODO(batch-ops): Add checkbox column for cargo row selection, wired to useSelection with getId = (m) => m.avatarId || m.name. */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>玩家 ID</TableHead>
            <TableHead>成员</TableHead>
            <TableHead>
              <button type="button" className="cursor-pointer hover:text-foreground" onClick={() => toggleCargoSort("tFeat")}>
                今日武勋 <SortIndicator active={cargoSort.key === "tFeat"} direction={cargoSort.direction} />
              </button>
            </TableHead>
            <TableHead>
              <button type="button" className="cursor-pointer hover:text-foreground" onClick={() => toggleCargoSort("tForageUse")}>
                今日辎重 <SortIndicator active={cargoSort.key === "tForageUse"} direction={cargoSort.direction} />
              </button>
            </TableHead>
            <TableHead>周辎重</TableHead>
            <TableHead>
              <button type="button" className="cursor-pointer hover:text-foreground" onClick={() => toggleCargoSort("cargoRatio")}>
                武勋辎重比 <SortIndicator active={cargoSort.key === "cargoRatio"} direction={cargoSort.direction} />
              </button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cargoMembers.map((member) => (
            <TableRow key={`${member.avatarId || member.name}-${member.coord}-${member.official}`}>
              <TableCell>{member.avatarId || "-"}</TableCell>
              <TableCell>{member.name}</TableCell>
              <TableCell className="text-right tabular-nums">{(member.tFeat ?? 0).toLocaleString("zh-CN")}</TableCell>
              <TableCell className="text-right tabular-nums">{(member.tForageUse ?? 0).toLocaleString("zh-CN")}</TableCell>
              <TableCell className="text-right tabular-nums">{(member.wForageUse ?? 0).toLocaleString("zh-CN")}</TableCell>
              <TableCell className="text-right tabular-nums">{formatAllianceCargoRatio(member.tFeat, member.tForageUse)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
