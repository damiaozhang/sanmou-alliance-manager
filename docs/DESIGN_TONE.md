# 设计基调说明（S3 页面重设计 · 必读）

> **部分取代说明（2026-10-09）：** 本文 §3 / §6 / §7 已被 2026-10-09 前端重构规格部分取代，
> 见 `docs/superpowers/specs/2026-10-09-frontend-redesign-design.md` §2。
> 新规格引入表面分层（surface-0/1/2/rail）、卡片 hover 微浮起与受控动效；
> 与本文冲突处以新规格为准，其余章节（字阶、语义令牌纪律）仍然有效。

> 定稿日期：2026-07-31。S3 所有页面重设计任务以此为准；与方案文档冲突处以此文件为准。
> 本文件只做**用法纪律**，不新增设计令牌——S0/S1 已注册的语义令牌（victory/defeat/draw/side/rank/info/warning/success、text-metric、text-caption、tabular-nums）是唯一来源。

## 1. 设计性格：作战指挥仪表

这是一个数据密集的桌面管理工具，用户是管理和分析者，不是被营销者。性格定为**精密测量仪器 / 作战指挥室**：数据即情报，界面退后一步。克制、密度、可读性优先于装饰；视觉兴趣来自数据呈现本身（大数字、热力色、进度、状态徽章），不来自渐变、圆角堆叠或动效表演。

## 2. 密度与字阶

| 用途 | 规格 |
|---|---|
| 页面标题 | PageShell 统一（不动） |
| 正文 / 表单 | 14px，font-normal |
| 次级说明 / 表格正文 | 13px（`text-caption`） |
| 辅助标签（KPI 标签、区块小标题、表尾说明） | 12px + `text-muted-foreground` + `tracking-wide`（中文无大写，用小字号+字距+弱色建立层级） |
| 指标大数字 | `text-metric`（22px）起，KPI 条主数字可 28px/`text-3xl`，一律 `tabular-nums` |
| ID / 时间戳 / 数字列 | `tabular-nums`；等宽语境（ID、版本号）用 `font-mono` |

- 字重只用 400 / 500 / 600；**中文禁用 italic**（强调用字重或颜色）。
- 间距遵循 4px 网格；内容区 `px-6 py-6`（PageShell 已定）。
- 文字三级梯队：`foreground` → `muted-foreground` → `muted-foreground/70`（最弱档仅用于 hint/placeholder 级信息）。

## 3. 层级手法：hairline，不堆卡片

- 分区用 **1px `border`** 分隔或留白+字重对比，**不用阴影堆叠、不用卡片套卡片**。一页内卡片层级 ≤2。
- KPI 条优先做成**一条 hairline 分隔的横排**（`divide-x` 或行间 `border-r`），而不是每个指标各自套一张卡。
- hover 反馈用背景/边框色微变（`hover:bg-muted/50`、`hover:border-foreground/20` 一档），**不用 translate/scale/shadow 浮起**。

## 4. KPI 呈现范式

上小下大：12px muted 标签在上，tabular-nums 大数字在下，右侧或下方可挂一个 delta/状态点（victory=↑、defeat=↓ 语义色 + 箭头）。无数据时显示 `—` 而不是 0。每页 KPI 条最多一排（4~6 个），超出说明信息架构有问题，回去砍。

## 5. 表格节奏

- sticky 表头 `bg-muted/50` + 12px muted 标签；行分隔用 hairline `divide-y`，行高紧凑（`py-2`~`py-2.5`）。
- 数字列右对齐 + `tabular-nums`；文本列左对齐；状态列用 StatusBadge 语义色。
- 虚拟滚动保留；表头/列错位修复与 `role="table"` 语义属 S3 同盟数据任务范围。
- 空态即引导：EmptyState 必须带 CTA（例：「暂无战报 → 去采集中心」）。

## 6. 色彩纪律

- **每页至多 1 个 primary 操作**；导出走 dropdown；危险操作 destructive + 确认。
- 语义色（victory/defeat/draw/warning/info）**只用于状态表达，不做装饰**。大面积色块只允许出现在热力矩阵、进度条、状态徽章。
- 胜率矩阵热力：victory→draw→defeat 连续色阶，用 `bg-victory/N` 不透明度梯度（N=10~80 按胜率映射），暗色主题同一套梯度即可（令牌已双主题适配）。
- 排行前三用 rank 令牌（legendary/elite/advanced），不发明新色。
- 暗色质感基准：近黑蓝底（`222 20% 6%`）已就位，卡片只提一档，分区靠 hairline；**禁止纯白发光、渐变光晕、玻璃拟态**。

## 7. 动效

- hover：`transition-colors` 150~200ms。
- 面板/对话框/进度：200~350ms ease-out 类缓动。
- **禁止**：无信息量的 fade-in-up、入场 stagger、scroll reveal、scale-105、旋转 loading（加载用骨架屏或 Spinner 既有组件）。
- `prefers-reduced-motion` 全局尊重在 S4 落地；S3 不新增违反此原则的动画。

## 8. 反模式清单（S3 审查必查）

1. 卡片套卡片（>2 层容器嵌套）
2. 裸色板类名（`text-green-500` 等，S0 已清零，不得复发）
3. 每页多个 primary 按钮
4. 数字不用 tabular-nums 的 KPI/表格数字列
5. 中文斜体、全大写英文标签硬翻（用第 2 节标签手法代替）
6. 装饰性渐变/光晕/玻璃拟态/emoji 图标（图标用 lucide）
7. 空态无 CTA、加载无骨架
8. 硬编码业务文案（走 labels.ts）与硬编码「每 N 分钟」类配置文案（读 config）
