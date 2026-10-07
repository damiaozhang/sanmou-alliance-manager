/**
 * 预览模式样本数据（仅浏览器 DEV 环境注入，见 main.tsx）。
 *
 * 为什么需要它：`mockState` 的初始值全为空，导致浏览器预览下所有页面只能渲染空态，
 * 无法评估信息密度、排版与交互——而预览模式的用途正是"不连 Tauri 也能看界面"。
 *
 * 玩家与同盟名称均为演示用虚构名称。
 *
 * 设计原则：
 * 1. **确定性**：用固定种子的伪随机，同一时刻生成的数据稳定，避免每次刷新数字乱跳；
 * 2. **规模贴近真实**：成员 24 人 / 战报 120 场（跨 7 天）/ 会话 6 次，其中包含失败会话；
 * 3. **口径正确**：战报 `result` 用协议原值「攻方胜 / 守方胜 / 平局」，
 *    胜率由 `attackerOutcomeFromResult` 解释（守方胜 = 攻击方负），不自行发明取值；
 * 4. **不侵入测试**：只在本模块被显式调用时写入 mockState，单元测试不 import 本文件。
 */

import { mockState } from "./mockState";
import { mondayWeekStart } from "@/lib/dates";
import type { CaptureSessionSummaryRecord } from "@/lib/bindings";
import type {
  AllianceFacilityRow,
  AllianceGroupRow,
  AllianceLogRow,
  AllianceMemberRow,
  BattleReportRow,
  CaptureSessionRow,
  ExportJobRow,
  LineupMatchupRow,
  LineupProfileRow,
  LineupStatRow,
  MemberBindingRow,
  MemberSnapshotRow,
  IntelSnapshotRow,
  IntelEntryRow,
  RawArtifactRow,
  WorkspaceRecord,
} from "./tauri";

// ── 确定性伪随机（LCG）：保证同一会话内数据稳定 ──
let seed = 20260921;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}
function between(min: number, max: number): number {
  return Math.floor(min + rnd() * (max - min + 1));
}

// ── 语料 ──
const MEMBER_NAMES = [
  "玄甲营", "子龙在世", "卧龙先生", "孟德", "翼德", "云长",
  "公瑾", "伯符", "仲谋", "文远", "汉升", "兴霸",
  "元让", "妙才", "文若", "奉孝", "公达", "仲德",
  "文和", "孝直", "幼平", "子敬", "伯言", "休昭",
] as const;

const ENEMY_ALLIANCES = ["碧海盟", "玄甲营", "江东子弟", "西凉铁骑"] as const;
const ENEMY_PLAYERS = [
  "虎豹骑", "青州兵", "白马义从", "陷阵营", "先登死士", "无当飞军",
  "长水校尉", "越骑校尉", "射声校尉", "屯骑校尉", "步兵校尉", "虎贲中郎",
] as const;

const OFFICIALS = ["盟主", "副盟主", "指挥官", "官员", "成员"] as const;
const PROFESSIONS = ["统率", "猛将", "谋士", "先锋", "后勤"] as const;
const LOCATIONS = ["赤壁", "江陵", "襄阳", "合肥", "汉中", "街亭"] as const;
const FORMATIONS = ["锋矢阵", "鱼鳞阵", "箕形阵", "雁行阵", "方圆阵"] as const;
const HERO_POOL = [
  "关羽 / 张飞 / 赵云", "曹操 / 郭嘉 / 张辽", "周瑜 / 陆逊 / 太史慈",
  "夏侯惇 / 许褚 / 徐晃", "吕布 / 高顺 / 张辽", "诸葛亮 / 姜维 / 马超",
  "孙策 / 甘宁 / 吕蒙", "司马懿 / 邓艾 / 钟会", "刘备 / 黄忠 / 魏延",
] as const;

/** 军团（legionId 与真实库一致：2=前锋营 … 8=游骑营） */
const LEGIONS: ReadonlyArray<{ id: number; name: string }> = [
  { id: 2, name: "前锋营" },
  { id: 3, name: "中军帐" },
  { id: 4, name: "左翼营" },
  { id: 5, name: "右翼营" },
  { id: 6, name: "后军帐" },
  { id: 7, name: "辎重营" },
  { id: 8, name: "游骑营" },
];

const FACILITIES: ReadonlyArray<{ name: string; type: string }> = [
  { name: "江陵城", type: "城池" },
  { name: "赤壁港", type: "港口" },
  { name: "襄阳关", type: "关卡" },
  { name: "樊城要塞", type: "要塞" },
  { name: "南郡农庄", type: "农庄" },
  { name: "云梦伐木场", type: "伐木场" },
  { name: "荆山铁矿", type: "铁矿" },
  { name: "洞庭采石场", type: "采石场" },
  { name: "校场", type: "练兵场" },
  { name: "军械坊", type: "军械坊" },
  { name: "粮仓", type: "粮仓" },
  { name: "烽火台", type: "烽火台" },
];

let seeded = false;

/**
 * 造同盟情报预览样本（四个域各一份快照 + 明细）。
 *
 * 与后端一致：快照承载指标与来源接口，明细用统一的
 * `(rank, subjectKey, name, unionName, value)` 五元组表达，
 * 前端只按 kind 换列定义 —— 预览里也能验证这套统一流程。
 */
function buildIntelPreview(
  names: string[],
  observedAt: string
): { snapshots: IntelSnapshotRow[]; entries: IntelEntryRow[] } {
  const snapshots: IntelSnapshotRow[] = [];
  const entries: IntelEntryRow[] = [];
  let snapshotId = 1;
  let entryId = 1;
  const unions = ["演示同盟甲", "演示同盟丙", "演示同盟乙", "演示同盟丁", "演示同盟戊", "演示同盟己"];
  const pick = (index: number) => names[index % names.length] ?? `玩家${index}`;

  // 1) 全服排行榜（繁荣榜·全职业）
  snapshots.push({
    id: snapshotId++,
    workspaceId: 1,
    allianceId: 1,
    kind: "server_rank",
    subjectKey: "00010006",
    subjectLabel: "繁荣榜·全职业",
    observedAt,
    entryCount: 20,
    metricsJson: JSON.stringify({ selfRank: 12, selfValue: 59723 }),
    sourceFunc: "RPCGetRankResponse"
  });
  for (let index = 0; index < 20; index += 1) {
    entries.push({
      id: entryId++,
      snapshotId: 1,
      kind: "server_rank",
      rank: index + 1,
      subjectKey: String(10002061834 + index * 137),
      name: pick(index * 3),
      unionName: unions[index % unions.length],
      value: 59723 - index * 780,
      extraJson: "{}"
    });
  }

  // 2) 武将红度普查（本人视角）
  const heroSnapshotId = snapshotId++;
  snapshots.push({
    id: heroSnapshotId,
    workspaceId: 1,
    allianceId: 1,
    kind: "hero_rating",
    subjectKey: "90000004001",
    subjectLabel: "本人阵容红度",
    observedAt,
    entryCount: 12,
    metricsJson: JSON.stringify({ heroCount: 12, fullRedCount: 3, totalRedScore: 4820 }),
    sourceFunc: "RPCGetAllAvatarHeroResponse"
  });
  const heroNames = ["钟会", "王平", "陈宫", "曹操", "陆逊", "周瑜", "司马懿", "张辽", "赵云", "孙权", "黄月英", "诸葛亮"];
  heroNames.forEach((heroName, index) => {
    const evolution = 5 - Math.floor(index / 3);
    const enlighten = index % 4;
    entries.push({
      id: entryId++,
      snapshotId: heroSnapshotId,
      kind: "hero_rating",
      rank: 0,
      subjectKey: String(1025 + index * 211),
      name: heroName,
      unionName: "",
      value: evolution * 100 + enlighten,
      // 明细里保留原始分项，便于核对红度分口径
      extraJson: JSON.stringify({ evolution, enlighten })
    });
  });

  // 3) 赛季战队（备战区一队）
  const teamSnapshotId = snapshotId++;
  snapshots.push({
    id: teamSnapshotId,
    workspaceId: 1,
    allianceId: 1,
    kind: "season_team",
    subjectKey: "88",
    subjectLabel: "备战区一队",
    observedAt,
    entryCount: 8,
    metricsJson: JSON.stringify({ memberCount: 8 }),
    sourceFunc: "RPCGetSelfTeamBaseInfoResponse"
  });
  for (let index = 0; index < 8; index += 1) {
    entries.push({
      id: entryId++,
      snapshotId: teamSnapshotId,
      kind: "season_team",
      rank: index === 0 ? 1 : index === 1 ? 2 : 0,
      subjectKey: String(10130058081 + index * 991),
      name: pick(index * 5),
      unionName: unions[index % unions.length],
      value: 35000 - index * 1200,
      extraJson: "{}"
    });
  }

  // 4) 主公簿
  const profileSnapshotId = snapshotId++;
  snapshots.push({
    id: profileSnapshotId,
    workspaceId: 1,
    allianceId: 1,
    kind: "player_profile",
    subjectKey: "90000005001",
    subjectLabel: "本人档案",
    observedAt,
    entryCount: 6,
    metricsJson: JSON.stringify({ prosperity: 48088, seasonScore: 14311 }),
    sourceFunc: "RPCGetPersonalInformationResponse"
  });
  for (let index = 0; index < 6; index += 1) {
    entries.push({
      id: entryId++,
      snapshotId: profileSnapshotId,
      kind: "player_profile",
      rank: 0,
      subjectKey: String(90000005001 + index * 517),
      name: pick(index * 7),
      unionName: unions[index % unions.length],
      value: 48088 - index * 2100,
      extraJson: JSON.stringify({ seasonScore: 14311 - index * 700 })
    });
  }

  return { snapshots, entries };
}

/**
 * 造 3 周「周维度统计」样本，与游戏 `weeklyStaticsticsData` 同构
 * （键为 `[number]1..3`，1 = 本周）。
 *
 * - 以成员序号为种子（确定性），同一成员多次刷新数值稳定；
 * - 每 3 人里有 1 人呈下降趋势，让「战功环比」列有正有负、便于核对配色；
 * - `phase === 1`（3 天前那期快照）整体缩小，模拟赛季推进中的增长。
 */
function buildWeeklyStatisticsJson(memberIndex: number, phase: 0 | 1, weekStartSec: number): string {
  const base = 4200 + ((memberIndex * 977) % 8800);
  const trend = memberIndex % 3 === 0 ? -1 : 1;
  const phaseDecay = phase === 1 ? 2 : 1;
  const weeks: Record<string, Record<string, number>> = {};
  for (let index = 0; index < 3; index += 1) {
    const factor = Math.max(0.3, 1 - index * 0.24 * trend);
    const feat = Math.round((base * factor) / phaseDecay);
    weeks[`[number]${index + 1}`] = {
      timestamp: weekStartSec - index * 7 * 86400,
      feat,
      contri: Math.round(feat * 0.42),
      seige: Math.round(feat * 0.6),
      demolish: Math.round(feat * 0.08),
      dismantle: 0,
      attack: 3 + ((memberIndex + index) % 9),
      occupy: (memberIndex + index) % 4,
      killNum: Math.round(feat * 0.9),
      wipeOut: 0,
    };
  }
  return JSON.stringify(weeks);
}

/** 幂等注入：重复调用（HMR / StrictMode）不会重复追加数据。 */
export function seedPreviewData(): void {
  if (seeded) return;
  seeded = true;

  const now = new Date();
  const nowMs = now.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const iso = (ms: number) => new Date(ms).toISOString();
  // 注意口径：lastOfflineTs / joinTs 是 **Unix 秒**（前端用 formatUnixSeconds 渲染），
  // 不是毫秒。写成毫秒会被当成秒解析，年份直接跑到 58690 年。
  const nowSec = Math.floor(nowMs / 1000);
  // 周维度样本必须锚定「本周一 00:00」，不能从"现在往回推 7 天"——
  // 后者在周日生成时会让 [number]1 落在上一周，与游戏协议口径不符。
  const weekStartSec = Math.floor(mondayWeekStart(now).getTime() / 1000);

  // ── 工作区 ──
  const workspaces: WorkspaceRecord[] = [
    {
      id: 1,
      name: "苍梧盟",
      serverName: "赤壁",
      seasonName: "S17",
      allianceId: 1001,
      allianceName: "苍梧盟",
      allianceGameId: "A1001",
      createdAt: iso(nowMs - 42 * dayMs),
      updatedAt: iso(nowMs - dayMs),
    },
    {
      id: 2,
      name: "碧海盟",
      serverName: "赤壁",
      seasonName: "S17",
      allianceId: 1002,
      allianceName: "碧海盟",
      allianceGameId: "A1002",
      createdAt: iso(nowMs - 38 * dayMs),
      updatedAt: iso(nowMs - 2 * dayMs),
    },
  ];

  // ── 成员（24 人，按军团分组坐席）──
  const members: AllianceMemberRow[] = MEMBER_NAMES.map((name, i) => {
    const legion = LEGIONS[i % LEGIONS.length];
    const online = rnd() > 0.45 ? 1 : 0;
    return {
      avatarId: `AV${100000 + i * 37}`,
      name,
      official: i === 0 ? "盟主" : i < 3 ? "副盟主" : i < 6 ? "指挥官" : pick(OFFICIALS),
      profession: pick(PROFESSIONS),
      isOnline: online,
      legion: legion.name,
      prosperity: between(1200, 4800),
      contribution: between(8000, 46000),
      merit: between(6000, 52000),
      seasonScore: between(180, 1450),
      lastOfflineTs: online ? 0 : nowSec - between(1, 40) * 60 * 60,
      demolition: between(200, 3800),
      coord: `${between(60, 180)},${between(320, 520)}`,
      status: "正常",
    };
  });

  // ── 成员快照：两期（今天 / 3 天前），供健康度时间序列 ──
  const memberSnapshots: MemberSnapshotRow[] = [];
  let snapshotId = 1;
  for (const [phase, offsetDays] of [[0, 0], [1, 3]] as const) {
    members.forEach((m, i) => {
      const legion = LEGIONS[i % LEGIONS.length];
      // 3 天前那期在线人数略少，让"在线趋势"分项有变化
      const online = phase === 0 ? m.isOnline : rnd() > 0.5 ? 1 : 0;
      memberSnapshots.push({
        id: snapshotId++,
        captureSessionId: phase === 0 ? 1 : 3,
        observedAt: iso(nowMs - offsetDays * dayMs),
        avatarId: m.avatarId,
        avatarName: m.name,
        officialName: m.official,
        professionName: m.profession,
        professionId: (i % 5) + 1,
        state: online ? "在线" : "离线",
        isOnline: online,
        roleId: 1,
        legionName: legion.name,
        legionId: legion.id,
        legionLeader: i % 8 === 0 ? 1 : 0,
        prosperity: m.prosperity - (phase === 1 ? between(50, 400) : 0),
        weeklyContribution: m.contribution - (phase === 1 ? between(200, 3000) : 0),
        weeklyMerit: m.merit - (phase === 1 ? between(200, 4000) : 0),
        seasonScore: m.seasonScore - (phase === 1 ? between(10, 120) : 0),
        demolitionValue: m.demolition,
        coordinateX: Number(m.coord.split(",")[0]),
        coordinateY: Number(m.coord.split(",")[1]),
        lastOfflineTs: online ? 0 : nowSec - between(1, 36) * 60 * 60,
        joinTs: nowSec - between(20, 40) * 24 * 60 * 60,
        tFeat: between(100, 900),
        tForageUse: between(1000, 9000),
        wForageUse: between(500, 4000),
        weeklyStatisticsJson: buildWeeklyStatisticsJson(i, phase, weekStartSec),
        rawJson: "{}",
      });
    });
  }

  // ── 采集会话（6 次，含 1 次失败、1 次进行中）──
  const sessions: CaptureSessionRow[] = [
    {
      id: 6, captureType: "battle_passive", status: "running",
      startedAt: iso(nowMs - 3 * 60 * 1000), finishedAt: null,
      summaryJson: undefined,
    },
    {
      id: 5, captureType: "battle_passive", status: "completed",
      startedAt: iso(nowMs - 6 * 60 * 60 * 1000), finishedAt: iso(nowMs - 6 * 60 * 60 * 1000 + 96 * 1000),
      summary: sessionSummary("completed", "抓取 128 场战报，覆盖 3 个敌方同盟"),
    },
    {
      id: 4, captureType: "alliance_data", status: "completed",
      startedAt: iso(nowMs - 9 * 60 * 60 * 1000), finishedAt: iso(nowMs - 9 * 60 * 60 * 1000 + 74 * 1000),
      summary: sessionSummary("completed", "成员 24 · 设施 12 · 军团分组 7 · 日志 30"),
    },
    {
      id: 3, captureType: "alliance_data", status: "completed",
      startedAt: iso(nowMs - 3 * dayMs), finishedAt: iso(nowMs - 3 * dayMs + 81 * 1000),
      summary: sessionSummary("completed", "成员 24 · 设施 12 · 军团分组 7"),
    },
    {
      id: 2, captureType: "battle_passive", status: "failed",
      startedAt: iso(nowMs - dayMs - 2 * 60 * 60 * 1000), finishedAt: iso(nowMs - dayMs - 2 * 60 * 60 * 1000 + 8 * 1000),
      summary: sessionSummary("failed", "游戏进程未找到，请先启动游戏客户端"),
    },
    {
      id: 1, captureType: "alliance_data", status: "completed",
      startedAt: iso(nowMs - 2 * dayMs), finishedAt: iso(nowMs - 2 * dayMs + 68 * 1000),
      summary: sessionSummary("completed", "成员 22 · 设施 11 · 军团分组 7"),
    },
  ];

  // ── 战报：跨 7 天共 120 场，今日密度更高；攻方胜率约 56% ──
  // 时刻以「当天 0 点」为锚点分配，而不是「现在往回推 N 分钟」——
  // 后者会让 dayIndex=0 的记录滑进昨天，导致「今日战报」恒为 0、
  // 「本周胜率」（周一起算）样本过少（周一打开时尤其明显）。
  const battleReports: BattleReportRow[] = [];
  const dailyCounts = [26, 22, 18, 16, 14, 13, 11];
  let battleSeq = 1;
  const todayStartMs = new Date(now).setHours(0, 0, 0, 0);
  const minutesElapsedToday = Math.max(1, Math.floor((nowMs - todayStartMs) / 60000));
  dailyCounts.forEach((count, dayIndex) => {
    const dayStartMs = todayStartMs - dayIndex * dayMs;
    const spanMinutes = dayIndex === 0 ? minutesElapsedToday : 1439;
    for (let k = 0; k < count; k += 1) {
      const r = rnd();
      const result = r < 0.56 ? "攻方胜" : r < 0.85 ? "守方胜" : "平局";
      const time = dayStartMs + Math.floor(rnd() * spanMinutes) * 60 * 1000;
      const enemy = pick(ENEMY_ALLIANCES);
      battleReports.push({
        workspaceId: 1,
        allianceId: 1001,
        time: iso(time),
        battleCode: `B2026${String(900000 + battleSeq).slice(-6)}`,
        enemy,
        enemyPlayer: pick(ENEMY_PLAYERS),
        result,
        round: between(3, 8),
        location: `${pick(LOCATIONS)} ${between(60, 180)},${between(320, 520)}`,
        lineup: pick(HERO_POOL),
        battleId: `BT${500000 + battleSeq}`,
        battlefieldEnvironmentJson: "{}",
      });
      battleSeq += 1;
    }
  });

  // ── 军团分组（7 个）──
  const groups: AllianceGroupRow[] = LEGIONS.map((legion, i) => ({
    captureSessionId: 4,
    groupId: i + 1,
    groupName: `${legion.name}主力`,
    legionId: legion.id,
    legionName: legion.name,
    memberCount: members.filter((_, mi) => mi % LEGIONS.length === i).length,
    observedAt: iso(nowMs - 9 * 60 * 60 * 1000),
    rawJson: "{}",
  }));

  // ── 设施（12 个）──
  const facilities: AllianceFacilityRow[] = FACILITIES.map((f, i) => ({
    name: f.name,
    facilityType: f.type,
    cfgId: 3000 + i,
    carrierId: `C${2000 + i}`,
    level: String(between(3, 10)),
    state: i % 7 === 0 ? "建设中" : "正常",
    coord: `${between(60, 180)},${between(320, 520)}`,
    operatorName: i % 4 === 0 ? members[i].name : "",
    benefit: between(120, 1800),
    effect: i % 3 === 0 ? "产量 +8%" : "守备 +5%",
  }));

  // ── 成员绑定（18 条生效，留 6 人未绑定）──
  const memberBindings: MemberBindingRow[] = members.slice(0, 18).map((m, i) => ({
    playerId: 9000 + i,
    allianceId: 1001,
    name: m.name,
    avatar: m.avatarId,
    alliance: "苍梧盟",
    status: i % 5 === 0 ? "待确认" : "已绑定",
    updated: iso(nowMs - between(1, 20) * dayMs),
    isActive: true,
  }));

  // section 必须用与前端一致的英文键（personnel/profession/siege/management/city）——
  // LogsTab 以此为过滤参数下推后端，写中文会导致日志页五个分类全部计数为 0 并显示空态。
  const logSections = ["personnel", "profession", "siege", "management", "city"] as const;
  const logTexts: Record<(typeof logSections)[number], string[]> = {
    personnel: ["加入同盟，途径：盟主邀请", "退出同盟", "被任命为副盟主"],
    profession: ["转职为谋士", "转职为猛将", "完成职业进阶任务"],
    siege: [
      `与 ${pick(ENEMY_ALLIANCES)} 交战，歼敌 ${between(2, 40)} 万；我方损失 ${between(1, 9)} 千、伤兵 ${between(1, 6)} 千，缴获辎重 ${between(200, 4000)}，战场位于 ${pick(LOCATIONS)}`,
      `集结进攻 ${pick(LOCATIONS)}，参战 ${between(3, 12)} 队，历时 ${between(20, 90)} 分钟拿下据点`,
    ],
    management: [
      `升级 ${pick(FACILITIES).name} 至 ${between(4, 9)} 级`,
      "调整军团分组编制：重新分配各团成员归属，并同步了辎重额度与设施驻守人员",
    ],
    city: [`占领 ${pick(LOCATIONS)} 城池，守军 ${between(2, 20)} 万溃散`, "城池耐久度恢复中"],
  };
  const allianceLogs: AllianceLogRow[] = Array.from({ length: 30 }, (_, i) => {
    const section = logSections[i % logSections.length];
    return {
      captureSessionId: 4,
      time: iso(nowMs - i * between(40, 200) * 60 * 1000),
      category: "同盟事件",
      section,
      actor: members[i % members.length].name,
      target: section === "siege" || section === "city" ? pick(ENEMY_ALLIANCES) : "",
      text: pick(logTexts[section]),
    };
  });

  // ── 阵容统计（8 条，供阵容中心）──
  const lineupStats: LineupStatRow[] = HERO_POOL.slice(0, 8).map((heroes, i) => {
    const battles = between(18, 92);
    const wins = Math.round(battles * (0.42 + rnd() * 0.3));
    const draws = between(0, Math.max(1, Math.round(battles * 0.08)));
    const losses = Math.max(0, battles - wins - draws);
    const player = members[i % members.length];
    return {
      id: 7000 + i,
      workspaceId: 1,
      avatarId: player.avatarId,
      playerName: player.name,
      allianceName: "苍梧盟",
      lineupKey: `L${i + 1}`,
      label: `第 ${i + 1} 队`,
      formationId: `F${i + 1}`,
      formationName: FORMATIONS[i % FORMATIONS.length],
      heroIdsJson: "[]",
      heroLevelsJson: "[]",
      avgEvolution: 3 + (i % 5),
      battles,
      wins,
      losses,
      draws,
      attackBattles: Math.round(battles * 0.6),
      defendBattles: battles - Math.round(battles * 0.6),
      totalMerit: between(40000, 260000),
      totalOriginTroops: between(200000, 900000),
      totalRemainingTroops: between(80000, 400000),
      totalWounded: between(20000, 160000),
      totalDead: between(8000, 70000),
      totalEnemyOriginTroops: between(200000, 900000),
      totalEnemyRemainingTroops: between(70000, 350000),
      totalEnemyWounded: between(18000, 150000),
      totalEnemyDead: between(9000, 80000),
      lossExchangeRatio: 0.9 + rnd() * 1.2,
      lastBattleTime: iso(nowMs - between(1, 60) * 60 * 1000),
      notes: null,
      observedAt: iso(nowMs - 9 * 60 * 60 * 1000),
    };
  });

  const lineupMatchups: LineupMatchupRow[] = Array.from({ length: 6 }, (_, i) => ({
    id: 8000 + i,
    workspaceId: 1,
    attackerAvatarId: members[i].avatarId,
    attackerPlayerName: members[i].name,
    attackerLineupKey: `L${(i % 3) + 1}`,
    attackerLineupLabel: `第 ${(i % 3) + 1} 队`,
    defenderAvatarId: `AV${200000 + i}`,
    defenderPlayerName: ENEMY_PLAYERS[i % ENEMY_PLAYERS.length],
    defenderLineupKey: `E${(i % 3) + 1}`,
    defenderLineupLabel: `敌第 ${(i % 3) + 1} 队`,
    outcome: i % 3 === 0 ? "win" : i % 3 === 1 ? "loss" : "draw",
    battleTime: iso(nowMs - between(1, 90) * 60 * 1000),
    battleCode: `B2026${900000 + i}`,
    observedAt: iso(nowMs - 9 * 60 * 60 * 1000),
    matchType: (i % 4) + 1,
    combatType: 1,
    scenarioId: 17,
    endRound: between(3, 8),
    location: `${pick(LOCATIONS)} ${between(60, 180)},${between(320, 520)}`,
  }));

  // ── 手动阵容档案（5 条）──
  const lineupProfiles: LineupProfileRow[] = HERO_POOL.slice(0, 5).map((heroes, i) => ({
    playerId: 9100 + i,
    allianceId: 1001,
    label: `固定队 ${i + 1}`,
    player: members[i].name,
    heroes,
    source: i % 2 === 0 ? `战报 BT${500000 + i}` : "手动固定",
    confidence: i % 3 === 0 ? "用户确认" : "推测",
  }));

  // ── 原始产物（8 条）──
  const rawArtifacts: RawArtifactRow[] = Array.from({ length: 8 }, (_, i) => ({
    id: 6000 + i,
    captureSessionId: (i % 3) + 3,
    artifactType: ["rpc_dump", "ui_snapshot", "static_config", "battle_block_list"][i % 4],
    path: `preview://captures/session-${(i % 3) + 3}/artifact-${i}.json`,
    sourceModule: "Data.Scenario17.Alliance",
    sourceFunc: ["getMemberList", "getFacilityList", "getAllianceLogs"][i % 3],
    capturedAt: iso(nowMs - (i + 1) * 40 * 60 * 1000),
    sha256: null,
    sensitiveScanStatus: "passed",
  }));

  // ── 导出任务（3 条）──
  const exportJobs: ExportJobRow[] = [
    {
      id: 5000, createdAt: iso(nowMs - 5 * 60 * 60 * 1000), jobKind: "lineup_library",
      format: "xlsx", target: "阵容库", status: "completed",
      outputPaths: ["preview://exports/阵容库_20260921.xlsx"],
    },
    {
      id: 5001, createdAt: iso(nowMs - 26 * 60 * 60 * 1000), jobKind: "bundle",
      format: "csv", target: "工作区全量", status: "completed",
      outputPaths: ["preview://exports/members.csv", "preview://exports/battles.csv"],
    },
    {
      id: 5002, createdAt: iso(nowMs - 2 * dayMs), jobKind: "battle_report",
      format: "html", target: "战报报告", status: "completed",
      outputPaths: ["preview://exports/战报报告.html"],
    },
  ];

  // ── 写入 mockState ──
  mockState.workspaces = workspaces;
  mockState.battleReports = battleReports;
  mockState.memberSnapshots = memberSnapshots;
  mockState.allianceLogs = allianceLogs;
  const intel = buildIntelPreview(members.map((m) => m.name), iso(nowMs));
  mockState.intelSnapshots = intel.snapshots;
  mockState.intelEntries = intel.entries;

  const onlineCount = members.filter((m) => m.isOnline === 1).length;
  mockState.summary = {
    workspaceCount: workspaces.length,
    allianceCount: 2,
    captureSessionCount: sessions.length,
    rawArtifactCount: rawArtifacts.length,
    exportJobCount: exportJobs.length,
    memberSnapshotCount: memberSnapshots.length,
    buildingSnapshotCount: facilities.length,
    battleBlockCount: battleReports.length,
    lineupProfileCount: lineupProfiles.length,
    databasePath: "preview://未连接 Tauri，以下为预览样本数据",
  };

  mockState.bundle = {
    summary: mockState.summary,
    workspaces,
    captureSessions: sessions,
    rawArtifacts,
    exportJobs,
    allianceMembers: members,
    allianceFacilities: facilities,
    allianceGroups: groups,
    lineupProfiles,
    memberBindings,
  };

  mockState.lineupStats = lineupStats;
  mockState.lineupMatchups = lineupMatchups;

  void onlineCount;
}

function sessionSummary(status: string, note: string): CaptureSessionSummaryRecord {
  return {
    collector: "preview",
    status,
    note,
    capture: {
      collectorMode: "preview",
      captureType: status === "failed" ? "battle_passive" : "alliance_data",
      runtime: { recordCount: status === "failed" ? 0 : 128 },
    },
  };
}
