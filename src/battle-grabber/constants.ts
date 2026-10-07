import authoritativeTermsData from "./data/authoritativeTerms.json";
import type { AuthoritativeTerms } from "./types";

export const BRIDGE_EVENT_FLUSH_INTERVAL_MS = 100;
export const SNAPSHOT_REFRESH_DEBOUNCE_MS = 1200;
// 阶段3b：snapshot 改事件驱动（battle-grabber://snapshot-updated），此定时器仅作采集中的低频兜底
export const LIVE_CAPTURE_POLL_INTERVAL_MS = 5000;
export const VISIBLE_CAPTURE_PACKET_LIMIT = 120;
export const VISIBLE_CAPTURE_LOG_LIMIT = 240;
export const MIN_ALLIANCE_LINEUP_BATTLES = 2;

// ── 阵容质量阈值（终审口径，唯一定义处）──
// 依据 docs/STATISTICS.md「阵容过滤」章节（终审口径）：
// 兵力 >= 5000 且所有武将 level >= 46；兵力 <= 100 的是武将数（假兵力），跳过。
/** 阵容统计要求所有武将的最低等级 */
export const MIN_ALLIANCE_HERO_LEVEL = 46;
/** 阵容统计要求的最小兵力（totals.armyTroops） */
export const MIN_ALLIANCE_ARMY_TROOPS = 5000;
/** 兵力 <= 该值时是「武将数」而非兵力（假兵力），记录需跳过 */
export const FAKE_ARMY_TROOPS_MAX = 100;

export const AUTHORITATIVE_TERMS = authoritativeTermsData as AuthoritativeTerms;
export const AUTHORITATIVE_HERO_NAMES = AUTHORITATIVE_TERMS.heroes ?? {};

export const FORMATION_NAME_OVERRIDES: Record<string, string> = {
  "101": "一字阵",
  "201": "箕形阵",
  "301": "雁形阵",
  "401": "鱼鳞阵",
  "501": "锥形阵",
  "601": "方圆阵",
  "701": "钩行阵",
  "801": "偃月阵",
};

export const AUTHORITATIVE_FORMATION_NAMES: Record<string, string> = {
  ...(AUTHORITATIVE_TERMS.formations ?? {}),
  ...FORMATION_NAME_OVERRIDES,
};

export const AUTHORITATIVE_SKILL_NAMES = AUTHORITATIVE_TERMS.skills ?? {};
export const AUTHORITATIVE_WARBOOK_NAMES = AUTHORITATIVE_TERMS.warbooks ?? {};
export const AUTHORITATIVE_EQUIPMENT_NAMES = AUTHORITATIVE_TERMS.equipment ?? {};
export const AUTHORITATIVE_HORSE_NAMES = AUTHORITATIVE_TERMS.horses ?? {};
export const AUTHORITATIVE_EQUIPMENT_EFFECT_NAMES = AUTHORITATIVE_TERMS.equipmentEffects ?? {};
export const AUTHORITATIVE_HORSE_EFFECT_NAMES = AUTHORITATIVE_TERMS.horseEffects ?? {};
export const AUTHORITATIVE_EQUIPMENT_SKILL_NAMES = AUTHORITATIVE_TERMS.equipmentSkills ?? {};
export const AUTHORITATIVE_HORSE_SKILL_NAMES = AUTHORITATIVE_TERMS.horseSkills ?? {};

export const CAPTURE_DIR_STORAGE_KEY = "battleGrabberV6.captureDir";
/** 旧版存储键（工作区旧称「扫描工作区」），仅用于一次性迁移时读取：读旧写新，保留旧键不删。 */
export const LEGACY_SCAN_WORKSPACE_STORAGE_KEY = "battleGrabberV6.scanWorkspace";

export const ALLIANCE_HERO_NAME_OVERRIDES: Record<string, string> = {
  "1000": "曹操",
  "1002": "典韦",
  "1008": "荀彧",
  "1009": "司马懿",
  "1014": "乐进",
  "1016": "夏侯渊",
  "1020": "王异",
  "1022": "郝昭",
  "1023": "夏侯惇",
  "1028": "王双",
  "2000": "刘备",
  "2002": "张飞",
  "2003": "诸葛亮",
  "2012": "赵云",
  "2013": "马云禄",
  "2015": "关羽",
  "2017": "魏延",
  "2019": "甘夫人",
  "2021": "姜维",
  "2022": "SP诸葛亮",
  "3000": "孙权",
  "3004": "大乔",
  "3007": "周瑜",
  "3008": "陆逊",
  "3014": "周泰",
  "3016": "陆抗",
  "3018": "SP周瑜",
  "4001": "张辽",
  "4005": "孟获",
  "4006": "祝融夫人",
  "4008": "于吉",
  "4012": "左慈",
  "4015": "马腾",
  "4016": "田丰",
  "4023": "诸葛亮",
  "4024": "张宁",
  "4027": "袁术",
  "4028": "董卓",
  "4030": "皇甫嵩",
  "4031": "张曼成",
  "4032": "孙坚",
  "4033": "木鹿大王",
  "5033": "诸葛瑾",
  "5051": "卢植",
  "5055": "张宝",
};

export const ALLIANCE_HERO_NAMES: Record<string, string> = {
  ...AUTHORITATIVE_HERO_NAMES,
  ...ALLIANCE_HERO_NAME_OVERRIDES,
};

export const ALLIANCE_SIDE_PREFIXES = ["attack", "defend"] as const;
