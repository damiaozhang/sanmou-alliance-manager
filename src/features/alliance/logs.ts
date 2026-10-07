// 同盟日志分类与展示（阶段4 自 helpers.ts 拆出）

import { cleanGameDisplayText } from "@/lib/format";

export type AllianceLogSectionKey = "personnel" | "profession" | "siege" | "management" | "city";

export const allianceLogSections: Array<{ key: AllianceLogSectionKey; label: string }> = [
  { key: "personnel", label: "成员" },
  { key: "profession", label: "职业" },
  { key: "siege", label: "攻城" },
  { key: "management", label: "管理" },
  { key: "city", label: "城池" }
];

// 同盟日志 mailNo 分类表（来自游戏协议）
// 攻城类：宣战/攻占/最后一击攻城等
const SIEGE_LOG_MAIL_NOS = ["1000007", "1000008", "1000010", "1000031", "1000310", "1000418", "1090212", "1090213"];
// 城池类：迁城/城池归属等
const CITY_LOG_MAIL_NOS = ["1000019", "1000254", "1000255", "1000261", "1000272", "1000292", "1000449", "1000450", "1001171"];

export function normalizeAllianceLogSection(log: { section?: string | null; category?: string | null; text: string }): AllianceLogSectionKey {
  const section = String(log.section ?? "").toLowerCase();
  if (
    section === "personnel" ||
    section === "profession" ||
    section === "siege" ||
    section === "management" ||
    section === "city"
  ) {
    return section;
  }
  const category = String(log.category ?? "");
  const mailNo = category.split(":").pop() ?? "";
  if (category.startsWith("personnel:") || mailNo === "1001336" || /加入了同盟|离开同盟/.test(log.text)) {
    return "personnel";
  }
  if (category.startsWith("profession:") || /军屯|耕作|铸币|开疆|增产/.test(log.text)) {
    return "profession";
  }
  if (
    SIEGE_LOG_MAIL_NOS.includes(mailNo) ||
    /宣战|攻占|最后一击攻城/.test(log.text)
  ) {
    return "siege";
  }
  if (
    CITY_LOG_MAIL_NOS.includes(mailNo) ||
    /迁城|城池|归属/.test(log.text)
  ) {
    return "city";
  }
  return "management";
}

export function allianceLogSectionLabel(section: AllianceLogSectionKey) {
  return allianceLogSections.find((item) => item.key === section)?.label ?? "管理";
}

export function formatAllianceLogActor(value?: string | null) {
  const text = cleanGameDisplayText(value);
  if (!text || /^system(mail)?(?::\d+)?$/i.test(text)) {
    return "系统";
  }
  return text;
}
