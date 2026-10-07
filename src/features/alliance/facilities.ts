// 同盟设施展示建模（阶段4 自 helpers.ts 拆出）

import { formatWanNumber } from "@/lib/format";

export type FacilitySectionKey = "garrison" | "siegeEngine" | "allianceBuilding";

export const facilitySections: Array<{ key: FacilitySectionKey; label: string }> = [
  { key: "garrison", label: "军屯" },
  { key: "siegeEngine", label: "器械" },
  { key: "allianceBuilding", label: "同盟建筑" }
];

export const siegeEngineNames: Record<number, string> = {
  1: "冲车",
  5: "投石车",
  6: "楼船"
};

export type AllianceDisplayFacility = {
  name: string;
  facilityType?: string;
  facilityTypeId?: number;
  roleFacilityType?: number;
  cfgId?: number;
  carrierId?: string;
  level: string;
  state: string;
  statusId?: number;
  coord?: string;
  operatorName?: string;
  benefit?: number;
  mineCount?: number;
  maxMineCount?: number;
  effect: string;
};

export type NormalizedFacility = AllianceDisplayFacility & {
  category: FacilitySectionKey;
  displayName: string;
  displayType: string;
  displayCoord: string;
  displayState: string;
  benefitText: string;
  remainingText: string;
  effectText: string;
};

export function numberOrZero(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function facilitySectionFor(facilityTypeId: number): FacilitySectionKey | null {
  if (facilityTypeId === 1) return "garrison";
  if (facilityTypeId === 2) return "siegeEngine";
  if (facilityTypeId === 5001) return "allianceBuilding";
  return null;
}

export function cleanFacilityName(value?: string) {
  const text = String(value ?? "").trim();
  if (!text || /^未知设施(?::0:0)?$/.test(text)) return "";
  if (/^军屯(?::1:0)?$/.test(text)) return "军屯";
  if (/^同盟建筑(?::5001:0)?$/.test(text)) return "同盟建筑";
  if (text.startsWith("器械/资源点配置")) return "";
  return text;
}

export function siegeEngineName(cfgId?: number) {
  const id = numberOrZero(cfgId);
  return siegeEngineNames[id] ?? (id ? `器械 ${id}` : "器械");
}

export function inferFacilityTypeId(item: AllianceDisplayFacility) {
  const explicit = numberOrZero(item.facilityTypeId);
  if (explicit) return explicit;
  const text = `${item.name ?? ""} ${item.facilityType ?? ""}`;
  if (/军屯/.test(text)) return 1;
  if (/器械|冲车|投石车|楼船/.test(text)) return 2;
  if (/同盟建筑/.test(text)) return 5001;
  return 0;
}

export function normalizeFacility(item: AllianceDisplayFacility): NormalizedFacility | null {
  const facilityTypeId = inferFacilityTypeId(item);
  const category = facilitySectionFor(facilityTypeId);
  if (!category) return null;

  const cfgId = numberOrZero(item.cfgId);
  const displayCoord = String(item.coord ?? "").replace(/^0,0$/, "").trim();
  const displayState = item.state || (item.statusId === 0 ? "空闲" : "使用中");
  const benefitText = formatWanNumber(item.benefit);
  const remainingText =
    numberOrZero(item.maxMineCount) > 0
      ? `${numberOrZero(item.mineCount)}/${numberOrZero(item.maxMineCount)}`
      : numberOrZero(item.mineCount)
        ? `${numberOrZero(item.mineCount)}`
        : "-";

  if (category === "garrison") {
    return {
      ...item,
      category,
      displayName: cleanFacilityName(item.name) || "军屯",
      displayType: "军屯",
      displayCoord,
      displayState,
      benefitText,
      remainingText,
      effectText:
        remainingText !== "-" || benefitText !== "-"
          ? [`剩余次数：${remainingText}`, `收益：${benefitText}`].filter((text) => !text.endsWith("：")).join(" / ")
          : item.effect || "-"
    };
  }

  if (category === "siegeEngine") {
    const name = siegeEngineName(cfgId);
    return {
      ...item,
      category,
      displayName: cleanFacilityName(item.name) || name,
      displayType: name,
      displayCoord,
      displayState,
      benefitText,
      remainingText,
      effectText: item.effect || displayState || "-"
    };
  }

  return {
    ...item,
    category,
    displayName: cleanFacilityName(item.name) || "同盟建筑",
    displayType: "同盟建筑",
    displayCoord,
    displayState,
    benefitText,
    remainingText,
    effectText: item.effect || "-"
  };
}
