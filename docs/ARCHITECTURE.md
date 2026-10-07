# Sanmou Ledger 系统架构

> Snapshot of the architecture as of the 2026-08 freeze.

## 系统总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    React 18 + TypeScript 前端                     │
│  总览 / 数据采集 / 战报采集 / 同盟数据 / 阵容中心 /               │
│  时间对比 / 战报时间线 / 设置                                     │
│           ▲ react-query 数据层 (src/app/queries|mutations)       │
│           ▲ ts-rs bindings (src/lib/bindings/)                   │
│           ▲ invoke() 封装 (src/tauri.ts)                         │
├───────────┼──────────────────────────────────────────────────────┤
│           │       Tauri 2 IPC（49 个 command，快照测试守护）      │
│  ┌────────┴────────────────────────────────────────────────┐     │
│  │              Rust 后端 (sanmou-alliance-manager)          │     │
│  │                                                           │     │
│  │  ┌──────────────────┐  ┌───────────┐  ┌───────────────┐  │     │
│  │  │  Tauri Commands   │  │ db/ 模块组 │  │   Collector   │  │     │
│  │  │  (lib.rs)         │  │  SQLite   │  │ (collector.rs)│  │     │
│  │  │  · 工作区 CRUD    │  │  WAL 模式  │  │  sidecar 进程 │  │     │
│  │  │  · 采集会话管理   │  │  rusqlite │  │  管理+JSONL   │  │     │
│  │  │  · 阵容/绑定/统计 │  │            │  └───────┬───────┘  │     │
│  │  │  · 多格式导出     │  └───────────┘          │          │     │
│  │  └──────────────────┘                          │          │     │
│  │  ┌──────────────────┐                          │          │     │
│  │  │ battle_grabber   │                          │          │     │
│  │  │ · Frida bridge   │                 ┌────────┴───────┐  │     │
│  │  │ · 进程发现/注入  │                 │ Collector      │  │     │
│  │  │ · 战报扫描 V6    │                 │ Sidecar        │  │     │
│  │  └──────────────────┘                 │ native 主路径 / │  │     │
│  └───────────────────────────────────────│ Python 回退    │──┘     │
│                                          └────────┬───────┘        │
│                    ┌──────────────────────────────┴────────────┐   │
│                    │         Frida Runtime Scan                │   │
│                    │  frida_nslg_runtime_scan.py               │   │
│                    │  · attach / hook 安装 / RPC dump          │   │
│                    │  · JSONL 证据输出（扫描重试 + 超时 fail-  │   │
│                    │    fast，见 runtime_probe.py）            │   │
│                    └──────────────┬────────────────────────────┘   │
│                                   │ (Frida attach)                 │
│                    ┌──────────────┴────────────────────────────┐   │
│                    │      目标游戏进程 (NSLG)                   │   │
│                    │   · Lua RPC hooks · UI cache dump          │   │
│                    │   · Passive battle listener                │   │
│                    └────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Tauri | 2.9 |
| 前端 | React + TypeScript | 18.3 / 5.6 |
| 数据层 | @tanstack/react-query + Zustand | 5.x |
| 构建 | Vite | 5.4 |
| UI 样式 | Tailwind CSS | 3.4 |
| UI 组件 | Radix UI (shadcn/ui) + Lucide icons | — |
| 后端语言 | Rust | edition 2021 |
| 数据库 | SQLite (rusqlite, bundled, WAL) | 0.32 |
| 类型契约 | ts-rs（Rust 结构体 → TS bindings） | — |
| 游戏采集 | Python / Frida | 3.11+ / Frida 16+ |
| 打包 | Tauri NSIS installer + updater | — |

## 前端结构

### 数据层（react-query）

- `src/tauri.ts`：Tauri IPC 桥接层，所有 `invoke()` 封装与浏览器预览 mock 的唯一入口。
- `src/app/queries.ts`：服务端数据 query key 登记表（`appKeys`）与 `useAppData()`
  （bundle / summary / collector / exportDirectory / lineupAnalysis 五类 useQuery 组合）；
  `useRefreshAppData()` 按前缀失效五类 key 并 fetch 最新 bundle。
- `src/app/mutations.ts`：写操作 useMutation 集合，onSuccess 按 key 前缀失效。
- `src/app/routes.tsx`：路径常量表 `ROUTE_PATHS`、旧 hash 重定向映射、侧栏导航配置
  与全部页面的 lazy 加载。
- `src/app/AppShell.tsx` + `providers.tsx`：布局壳与 QueryClient/Router Provider。

### IPC 类型契约（ts-rs bindings）

Rust 端模型通过 ts-rs 生成 TypeScript 类型到 `src/lib/bindings/`（约 67 个类型文件 +
`index.ts` 聚合导出）。前端一律消费 bindings 类型，不手写 IPC 数据结构；新增/修改
Rust 模型后需重新生成 bindings 保持契约一致。

### 页面清单（与 `src/app/routes.tsx` 一致）

| 路由 | 页面组件 | 说明 |
|------|----------|------|
| `/dashboard` | `pages/Dashboard.tsx` | 总览：工作区管理、指标、证据链、导出任务 |
| `/capture` | `pages/CaptureHubPage.tsx` | 数据采集：单次采集 / 采集记录（`CaptureRecordTab`）/ 会话历史三 tab |
| `/battle-grabber` | `battle-grabber/BattleGrabberApp.tsx` | 战报采集 V6 独立子应用 |
| `/alliance` | `pages/AllianceDataPage.tsx` | 同盟数据：成员 / 设施 / 日志 / 辎重 / 绑定 / 活跃预警 tab（`pages/alliance/`） |
| `/lineups` | `pages/LineupHubPage.tsx` | 阵容中心：手动录入 / 自动采集 / 胜率 / 对阵 tab（`pages/lineup/`） |
| `/comparison` | `pages/ComparisonPage.tsx` | 时间对比：历史快照 + 可编辑时间窗 |
| `/timeline` | `pages/BattleTimelinePage.tsx` | 战报时间线 |
| `/settings` | `pages/SettingsPage.tsx` | 设置（含数据备份/恢复、诊断入口） |
| `/ranking` | `pages/AllianceRankingPage.tsx` | 玩家排行（兼容旧链接，已降为同盟数据 tab） |
| `/diagnostics` | `pages/Diagnostics.tsx` | 诊断（兼容旧链接，已并入设置页） |
| —（重定向） | `pages/PlayerProfilePage.tsx` | 玩家档案（旧入口重定向到同盟数据页） |

采集中心语义：同盟快照采集为「单次采集」模式——点一次采集一轮，采到数据后自动停止
并记录；不再有周期自动循环（`AutoCaptureTab` 已删除，`config.ts` 的 `repeatIntervalMs`
已移除）。

## Rust 后端结构

```
src-tauri/src/
├── main.rs               # 程序入口 (Windows subsystem)
├── lib.rs                # Tauri 命令注册（generate_handler!）+ app setup
│                         #   · WebView2 GPU 崩溃绕过（--in-process-gpu +
│                         #     swiftshader，lib.rs run() 启动段）
│                         #   · registered_command_list_matches_snapshot 快照测试
├── db/                   # SQLite 数据访问层（多文件模块组）
│   ├── mod.rs            #   建库/迁移/工作区/成员/快照/绑定/通用读写
│   ├── query.rs          #   bundle/summary/对比/预警/跨工作区序列等查询
│   ├── capture.rs        #   采集会话、raw_artifacts、preview 计数
│   ├── export.rs         #   导出任务与 JSON/CSV/HTML/XLSX 总包
│   ├── lineup.rs         #   阵容库/统计/对阵 upsert
│   └── helpers.rs        #   公共工具（JSON 序列化、行转换）
├── models.rs             # 数据结构定义（ts-rs 导出源）
├── collector.rs          # Collector 进程管理 + JSONL 通信
├── collector_sidecar.rs  # Rust native sidecar 实现（--collector-sidecar）
├── battle_grabber.rs     # 战报提取器 V6 桥接（进程发现/注入/导出）
├── proc_util.rs          # 进程工具
└── error.rs              # 错误类型
```

### Tauri IPC 契约

- `lib.rs` 的 `generate_handler![...]` 注册全部 **49 个命令**（工作区 CRUD、采集会话、
  阵容/绑定/统计、对比/预警、备份恢复、导出目录与四种总包导出、战报 V6 辅助命令等）。
- 同文件内 `REGISTERED_COMMANDS` 常量保存命令名快照，测试
  `registered_command_list_matches_snapshot` 在编译期源码上解析 `generate_handler!`
  块并与快照逐一比对：**新增/删除/重命名命令必须同步更新快照**，否则 `cargo test` 失败。
- 命令入参/出参类型集中在 `models.rs`，经 ts-rs 生成 `src/lib/bindings/`，
  前后端类型单一来源。

### SQLite（WAL）

- 配置：`journal_mode=WAL`、`foreign_keys=ON`、`cache_size=-64000`、`synchronous=NORMAL`。
- 库文件位于 `{app_data_dir}/sanmou-alliance-manager.db`。
- 所有业务数据按 `workspace_id` 外键隔离，前端始终在选中工作区上下文中操作。

## Collector Sidecar 架构

`collector/` 为 Python sidecar 套件；`src-tauri/src/collector_sidecar.rs` 为 Rust native
sidecar。两者由 `collector.rs` 统一拉起，经 stdin/stdout JSON Lines 协议通信
（`requestId` 关联请求-响应，详见 `docs/COLLECTOR_PROTOCOL.md`）。

优先级规则：

- `SMDC_RUNTIME_PROBE` 设置时 → 优先 Python sidecar（真实 Frida attach）；
- 否则 → Rust native sidecar（manifest 驱动的 preview/流量子模式，生产默认）；
- Rust native 启动失败 → 自动回退 Python（`python` / `py -3`）。

关键文件：

- `collector/collector_manifest.json`：manifest 驱动的 flow 定义（expectedArtifacts、
  navigation、nextProbe、超时/重试参数）。
- `collector/flows/`：flow handler 注册与实现（`alliance_data.py`、`battle_passive.py`）。
- `collector/runtime_probe.py`：runtime scan 适配器。扫描支持**重试**
  （`maxScanAttempts` / `retryDelaySeconds`，可经 `SMDC_RUNTIME_SCAN_*` 环境变量覆盖），
  子进程超时抛出 `RuntimeScanTimeoutError` 时**fail-fast 不重试**（frida attach 卡死在
  游戏进程内，重试只会延长卡死），并提示重启游戏。
- `collector/frida_nslg_runtime_scan.py`：Frida attach / hook 安装 / RPC dump，
  应用启动时经 `materialize_collector_assets()` 从 `include_str!` 资产落盘，
  与程序版本一致。
- `collector/export_bundle_xlsx.py`：XLSX 总包导出由 Python 子进程处理。

## 数据流（同盟快照单次采集）

```
游戏进程 (NSLG)
    │ Frida attach + Lua RPC hooks
    ▼
frida_nslg_runtime_scan.py（install → trigger 窗口 → dump，按 attempt 重试）
    │ JSONL 证据行
    ▼
collector_sidecar（runtime_probe 模式聚合为 capture_result 事件）
    │ stdin/stdout JSONL 协议
    ▼
collector.rs（子进程生命周期、SidecarEvent 解析、忙标记原子化）
    ▼
lib.rs start_capture_session（spawn_blocking）
    ▼
db/capture.rs → capture_sessions / raw_artifacts 落库
    ▼
SQLite (WAL)
    ▼
get_app_bundle / get_workspace_summary（lib.rs 命令）
    ▼
前端 useAppData()（react-query）→ 各页面渲染与导出
```

## 关键设计决策

1. **Sidecar 双路径**：Rust native 为生产主路径（快、无 Python 依赖），Python 保留为
   runtime probe / 回退；选择逻辑见上。
2. **JSONL 协议**：主进程与 sidecar 全部经 stdin/stdout JSON Lines 通信，协议文档见
   `docs/COLLECTOR_PROTOCOL.md`；测试回放支持 `SMDC_RUNTIME_PROBE_JSONL`。
3. **单次采集模式**：同盟快照采集点一次采一轮，采到数据自动停止；失败会话（0 条记录）
   不覆盖已有数据的展示会话（`AllianceDataPage` 会话选择优先「已完成且有数据」的
   runtime 会话）。
4. **证据优先级**：`RPC response > UI cache snapshot > static config`。
5. **资产内嵌**：Python 脚本编译期 `include_str!` 内嵌，启动时落盘 app data 目录，
   不依赖外部文件。
6. **IPC 契约守护**：49 命令快照测试 + ts-rs bindings，防止前后端类型漂移。
7. **导出格式覆盖**：JSON / CSV / HTML / XLSX 四种总包，均含同盟、战报、快照、
   绑定、阵容子表。
8. **WebView2 GPU 绕过**：虚拟显卡驱动（如网易UU远程）会导致 WebView2 GPU 进程
   反复崩溃，启动时注入 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
   （`--in-process-gpu --disable-gpu-compositing --use-angle=swiftshader`）绕过。
