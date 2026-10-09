# 前端重构设计规格 · 电竞数据台（变体A 折中升级）

- 日期：2026-10-09
- 状态：已确认（基调档位经视觉概念稿对比后选定为「变体A 折中升级」）
- 概念稿：`.qoder/frontend-concept/dashboard-concept.html`（`#a` 即本规格基准；`#b` 为被否决的更激进档）
- 取代关系：本规格**部分取代** `docs/DESIGN_TONE.md` 的 §3 / §6 / §7（见 §2），其余章节继续有效。

---

## 1. 背景与目标

用户反馈现有前端「特别落后、不好看、不现代、没有游戏助手的感觉」「看起来就是个网页，没有质感，交互很差」。

前端审计（2026-10-09）定位出 7 个**结构性**「网页感」根因（非配色问题）：

1. 内容区扁平纯白/纯暗，卡片仅靠 hairline + `0 1px 2px/0.05` 阴影分隔，无厚度无分层；
2. 所有页面共用同一 `PageShell space-y-6 p-6` 节奏，无页面性格；
3. 表格主导（约 15/20 页用 shadcn Table），缺少「核心对象卡片」呈现；
4. 无持久 HUD：sidecar 状态/会话计时/新鲜度只藏在 28px footer 与顶栏 badge；
5. 浏览器式 SaaS 外壳（面包屑 header + 独立标题栏 + 扁平宽侧栏）；
6. 动效预算近乎为零（仅 0.15s fadeSlideIn + hover transition-colors），无按压/悬浮/数字反馈；
7. 办公蓝 muted 配色 + 扁平 web 导航。

目标：在**保留现有信息架构与数据层**的前提下，把外壳、设计系统、动效、逐页呈现重构为「电竞数据台」质感。

非目标：不改路由/IA、不改 React Query hooks / `src/tauri.ts` IPC / 业务计算 / ts-rs 绑定、不重写测试。

---

## 2. 基调决议（对 DESIGN_TONE.md 的取代）

概念稿对比后选定**变体A 折中升级**。据此对 `docs/DESIGN_TONE.md` 做如下**局部取代**：

| DESIGN_TONE 章节 | 处置 | 说明 |
|---|---|---|
| §3 层级手法 | **取代** | 允许 3 级表面分层 + 厚度投影 + 内发光细边；允许**克制** hover 抬升（translateY(-2px) + 投影加深 + 边框提亮）。仍禁止卡片套卡片 >2 层。 |
| §6 色彩纪律（后半） | **部分取代** | 仍禁止大面积渐变光晕 / 玻璃拟态 / 纯白发光；**允许**单层内发光细边（inset highlight）与深色厚度投影作为材质。语义色仍只用于状态表达。 |
| §7 动效 | **取代** | 允许：按压 `active:scale(0.97)`、hover 抬升、HUD/在线点 pulse、KPI 数字 count-up、数据柱入场生长。仍禁止：无信息量的入场 stagger、scroll reveal、`scale-105` 大幅缩放、旋转 loading。 |
| §1 性格 / §2 字阶密度 / §4 KPI 范式 / §5 表格节奏 / §6 语义色前半 / §8 反模式 | **保留有效** | 作战指挥仪表性格、字阶、KPI hairline 横排、表格节奏、语义色只表状态、无障碍与反模式清单全部继续遵守。 |

即：**拿到厚度与实时感，但不引入霓虹/渐变/玻璃拟态的装饰表演。**

---

## 3. 设计系统 Token

深色为默认主题；浅色保留为可切换备选，同一套语义映射仅翻转明度层。

### 3.1 表面分层（新增，取代单一 card）
- `--surface-0`：窗口基底（近黑蓝，深色约 `#0b0e14`）。
- `--surface-1`：卡片/面板（约 `#12161f`）。
- `--surface-2`：悬浮/嵌套/ hover 提亮（约 `#171c27`）。
- `--surface-rail`：图标轨与 HUD 脊（比 surface-0 更暗，约 `#080a0f`）。

### 3.2 边框与材质
- `--border`：`rgba(255,255,255,0.07)`（发丝，分区）。
- `--border-strong`：`rgba(255,255,255,0.12)`（hover/强调）。
- `--inset-hi`：`inset 0 1px 0 rgba(255,255,255,0.035)`（顶部内发光细边，制造厚度）。
- `--shadow-card`：`0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.28)`。
- `--shadow-card-hover`：`0 2px 4px rgba(0,0,0,.45), 0 14px 36px rgba(0,0,0,.4)`。

### 3.3 圆角 / 字阶
- `--radius`：卡片 12px、控件 8px、徽章 5px（比现 0.375rem 略放大以利利落感）。
- 字阶沿用 DESIGN_TONE §2：正文 14 / 表格与说明 13（`text-caption`）/ 辅助标签 12 muted / KPI 大数字 `text-metric`(22px) 起、主 KPI 可 26–28px，一律 `tabular-nums`。字重仅 400/500/600，中文禁斜体。

### 3.4 语义色（沿用现有令牌，不新造）
- primary：电竞青蓝（深色约 `#38bdf8`），每页至多 1 个 primary 操作。
- victory / defeat / draw / warning / info / success：沿用现令牌，仅表状态。
- 阵营 side-ally/side-enemy、战力 rank-*：沿用。

---

## 4. 应用外壳（Command Console Chrome）

替换现 `AppShell.tsx` 的「独立标题栏 + 面包屑 header + 208px 宽侧栏 + 28px footer」为三层指挥台：

1. **图标轨（56px，常驻收起）**：品牌徽标 + 分组图标（采集/数据/洞察/系统）+ 底部主题/设置。active 项左侧 3px 指示条。hover 展开标签用 Tooltip（不常驻宽侧栏）。窗口拖拽区在顶栏。
2. **融合顶栏（40px）**：左侧「产品名 · 当前页」轻量上下文（**去掉面包屑层级**），右侧搜索胶囊（Ctrl+K）+ 窗口控件（—□✕）。
3. **HUD 状态脊（34px，常驻底部）**：sidecar 在线（pulse 点 + 版本）、采集会话计时、工作区名、数据新鲜度、告警计数、DB 体积。实时可见，取代现 footer 小字。

内容区顶部为**作战头**：页标题 + 一句口径说明 + 右侧页级动作（每页 ≤1 primary）。取代现面包屑 header 与 PageShell 页头的浏览器式排布。

---

## 5. 组件分层

- **primitives**（改造现有 shadcn/ui 材质与态）：button / card / badge / table / dialog / tabs / tooltip / select / input。统一接入 §3 token 与 §6 动效。
- **composites**（新增）：
  - `AppIconRail`、`AppTopBar`、`HudStatusBar`（外壳三件）。
  - `PageHead`（作战头，取代 PageShell 页头）。
  - `KpiStrip`（hairline 横排 KPI，含 count-up 与 delta）。
  - `UnitCard`（核心对象卡：成员/阵容/战报摘要）。
  - `EnhancedTable`（sticky 表头 + 行 hover 提亮 + 行内快捷动作 + 状态色徽章 + 密度切换）。
  - `LiveSessionCard`（采集会话：pulse 点 + 计时 + 进度）。

---

## 6. 动效与交互模型

允许（变体A）：
- 按压：`active:scale(0.97)`，120ms。
- hover：卡片 `translateY(-2px)` + `--shadow-card-hover` + 边框提亮，160ms；表格行/导航背景色微变。
- HUD/在线点：`pulse` 呼吸（1.8s）。
- KPI 数字：进入时 count-up（rAF，700ms，ease-out-cubic）。
- 数据柱/进度：入场高度生长（600ms，cubic-bezier(0.22,1,0.36,1)）。
- 页面进入：保留轻量 fade+4px 上移（不 stagger）。

禁止：入场 stagger、scroll reveal、`scale-105`、旋转 loading（用骨架屏）、渐变光晕、玻璃拟态。

全局尊重 `prefers-reduced-motion`（现有 media query 保留）。

---

## 7. 逐页重构（11 路由，IA 不变）

路由与导航分组保持 `routes.tsx` 现状。仅重构呈现骨架：

- **核心对象页** → 卡片网格为主：`/dashboard`（KpiStrip + 趋势 + LiveSession + 最近战报 + 成员TOP，即概念稿）、`/alliance`、`/lineups`、`/player/:avatarId`。弱化表格为辅助。
- **密集日志页** → `EnhancedTable`：`/timeline`、`/battle-grabber`、`/capture` 明细、`/diagnostics`。
- **对比/排名页** → 混合：顶部对比/排名卡 + 下方数据表：`/comparison`、`/ranking`。
- **设置页** → 分组卡片 + 开关行：`/settings`。
- 每页接 `PageHead`；核心页在头下加页级 HUD strip（该页 3–5 个关键实时指标）。

---

## 8. 不变量（红线）

- 路由/IA/导航分组不变；`LEGACY_VIEW_TO_PATH` 兼容不变。
- 数据层不动：React Query hooks、`src/tauri.ts`、业务计算、ts-rs 绑定。
- 282 前端测试 / 6 Python / 116 cargo 保持绿；新增组件补测试。
- 无障碍：WCAG 对比度（success/warning 已修订值）、`tabular-nums`、空态带 CTA、加载用骨架屏，全部保留。
- 不引入新重依赖（动效一律手写 rAF/CSS）。

---

## 9. 验收标准

1. 外壳三件（图标轨/融合顶栏/HUD 脊）在全部 11 路由一致呈现，无面包屑、无 28px 旧 footer。
2. 深色为默认；浅色可切换且语义映射一致。
3. 核心对象页为卡片网格、日志页为 EnhancedTable，符合 §7 映射。
4. §6 允许的动效就位且 `prefers-reduced-motion` 下全部降级。
5. 全测试绿；`npm run tauri dev` 实机截图与概念稿 `#a` 视觉一致度达标。
