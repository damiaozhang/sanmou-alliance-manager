import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { ROUTE_PATHS } from "@/app/routes";
import {
  type FacilitySectionKey,
  type NormalizedFacility,
  facilitySections
} from "@/features/alliance/facilities";

export function FacilitiesTab({
  facilities
}: {
  facilities: NormalizedFacility[];
}) {
  const navigate = useNavigate();
  const [facilitySection, setFacilitySection] = useState<FacilitySectionKey>("garrison");
  const facilitySectionCounts = facilitySections.reduce<Record<FacilitySectionKey, number>>(
    (counts, item) => {
      counts[item.key] = facilities.filter((facility) => facility.category === item.key).length;
      return counts;
    },
    { garrison: 0, siegeEngine: 0, allianceBuilding: 0 }
  );
  const visibleFacilities = facilities.filter((item) => item.category === facilitySection);
  const siegeEngineCounts = facilities
    .filter((item) => item.category === "siegeEngine")
    .reduce<Record<string, number>>((counts, item) => {
      counts[item.displayType] = (counts[item.displayType] ?? 0) + 1;
      return counts;
    }, {});

  return (
    <div className="space-y-4">
      <Tabs value={facilitySection} onValueChange={(v) => setFacilitySection(v as FacilitySectionKey)}>
        <TabsList>
          {facilitySections.map((section) => (
            <TabsTrigger key={section.key} value={section.key}>
              {section.label} <Badge variant="secondary" className="ml-1">{facilitySectionCounts[section.key]}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex gap-4 text-sm">
        <span>军屯 <Badge>{facilitySectionCounts.garrison}</Badge></span>
        <span>冲车 <Badge>{siegeEngineCounts["冲车"] ?? 0}</Badge></span>
        <span>投石车 <Badge>{siegeEngineCounts["投石车"] ?? 0}</Badge></span>
        <span>楼船 <Badge>{siegeEngineCounts["楼船"] ?? 0}</Badge></span>
        <span>同盟建筑 <Badge>{facilitySectionCounts.allianceBuilding}</Badge></span>
      </div>
      <Separator />
      {facilitySection === "garrison" && (
        visibleFacilities.length === 0 ? (
          <EmptyState
            title="当前批次没有军屯数据。"
            action={{ label: "去采集中心", onClick: () => navigate(ROUTE_PATHS.capture) }}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>建筑名</TableHead>
                <TableHead>位置</TableHead>
                <TableHead>建造者</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>剩余次数</TableHead>
                <TableHead>收益</TableHead>
                <TableHead>效果</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleFacilities.map((item) => (
                <TableRow key={`${item.displayName}-${item.displayCoord}-${item.operatorName}-${item.remainingText}`}>
                  <TableCell>{item.displayName}</TableCell>
                  <TableCell>{item.displayCoord || "-"}</TableCell>
                  <TableCell>{item.operatorName || "-"}</TableCell>
                  <TableCell>{item.displayState}</TableCell>
                  <TableCell className="tabular-nums">{item.remainingText}</TableCell>
                  <TableCell>{item.benefitText}</TableCell>
                  <TableCell>{item.effectText}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      )}
      {facilitySection === "siegeEngine" && (
        visibleFacilities.length === 0 ? (
          <EmptyState
            title="当前批次没有器械数据。"
            action={{ label: "去采集中心", onClick: () => navigate(ROUTE_PATHS.capture) }}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>建筑名</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>位置</TableHead>
                <TableHead>建造者</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>载体 ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleFacilities.map((item) => (
                <TableRow key={`${item.displayType}-${item.displayCoord}-${item.carrierId}-${item.operatorName}`}>
                  <TableCell>{item.displayName}</TableCell>
                  <TableCell>{item.displayType}</TableCell>
                  <TableCell>{item.displayCoord || "-"}</TableCell>
                  <TableCell>{item.operatorName || "-"}</TableCell>
                  <TableCell>{item.displayState}</TableCell>
                  <TableCell className="tabular-nums">{item.carrierId || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      )}
      {facilitySection === "allianceBuilding" && (
        visibleFacilities.length === 0 ? (
          <EmptyState
            title="当前批次没有同盟建筑数据。"
            action={{ label: "去采集中心", onClick: () => navigate(ROUTE_PATHS.capture) }}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>建筑名</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>位置</TableHead>
                <TableHead>建造者</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>效果</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleFacilities.map((item) => (
                <TableRow key={`${item.displayName}-${item.displayCoord}-${item.displayState}`}>
                  <TableCell>{item.displayName}</TableCell>
                  <TableCell>{item.displayType}</TableCell>
                  <TableCell>{item.displayCoord || "-"}</TableCell>
                  <TableCell>{item.operatorName || "-"}</TableCell>
                  <TableCell>{item.displayState}</TableCell>
                  <TableCell>{item.effectText}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      )}
    </div>
  );
}
