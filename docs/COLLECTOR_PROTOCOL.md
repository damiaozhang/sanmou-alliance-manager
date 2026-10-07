# Collector Sidecar JSONL 协议

## 概述

Collector 采用 **stdin/stdout JSON Lines** 协议。Rust 主进程 (collector.rs) 与 sidecar 进程 (Rust native 或 Python) 通过管道通信。每条消息为一行 JSON，以 `\n` 换行符分隔。请求-响应对通过 `requestId` 字段关联。

## 消息格式

### 请求 (Rust → Sidecar)

通过 stdin 发送，每行一条：

```json
{
  "requestId": "<unique-id>",
  "command": "<command-name>",
  "payload": { ... }
}
```

| 字段 | 类型 | 必须 | 说明 |
|------|------|------|------|
| `requestId` | string | 是 | 请求唯一标识，格式 `req-{millis}-{counter}` |
| `command` | string | 是 | 命令名: `status` / `start_capture` / `stop` |
| `payload` | object | 否 | 命令参数 |

### 事件 (Sidecar → Rust)

通过 stdout 返回，每行一条：

```json
{
  "type": "<event-type>",
  "requestId": "<original-request-id>",
  "sessionId": "<session-id>",
  "status": "<status-string>",
  "message": "<human-readable-message>",
  "payload": { ... }
}
```

| 字段 | 类型 | 必须 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 事件类型 (见下方) |
| `requestId` | string | 条件 | 响应时携带原始请求 ID，`hello` 事件无此字段 |
| `sessionId` | string | 条件 | 采集会话 ID，仅在采集相关事件中出现 |
| `status` | string | 否 | 状态: `ready` / `running` / `completed` / `failed` / `error` / `ok` / `info` |
| `message` | string | 否 | 人类可读的状态/错误描述 |
| `payload` | object | 否 | 事件数据载体 |

## 事件类型

### `hello`

Sidecar 启动后的第一条消息，表示就绪。

```json
{
  "type": "hello",
  "status": "ready",
  "message": "collector sidecar online"
}
```

无 `requestId`。

### `status`

响应 `status` 命令，返回当前 sidecar 状态和能力。

**请求**:
```json
{
  "requestId": "req-1718000000001-1",
  "command": "status"
}
```

**响应**:
```json
{
  "type": "status",
  "requestId": "req-1718000000001-1",
  "status": "ready",
  "message": "collector sidecar preview is ready",
  "payload": {
    "mode": "preview",
    "supports": ["status", "start_capture", "stop"],
    "ocr": false,
    "pdf": false,
    "manifestVersion": "2026-06-09",
    "manifestSource": "embedded:collector/collector_manifest.json",
    "captureFlows": {
      "alliance_data": {
        "flow": "alliance_runtime",
        "expectedArtifacts": ["rpc_dump", "ui_snapshot", "static_config"],
        "navigation": ["alliance_home", "member_list", "member_detail", "..."],
        "nextProbe": "__install_alliance_rpc_hooks__"
      },
      "battle_passive": {
        "flow": "battle_listener",
        "expectedArtifacts": ["battle_block_list", "battle_detail", "battle_environment"],
        "navigation": ["battle_entry", "battle_report_list", "sub_battle", "battle_detail"],
        "nextProbe": "__install_battle_listener_hooks__"
      }
    }
  }
}
```

**payload 字段**:
| 字段 | 说明 |
|------|------|
| `mode` | `"preview"` (dry-run) 或 `"runtime_probe"` (Frida live attach) |
| `supports` | 支持的命令列表 |
| `ocr` / `pdf` | 始终为 `false` (明确不做 OCR/PDF) |
| `manifestVersion` | Manifest 版本标识 |
| `captureFlows` | 可用采集流程及其元数据 |

Python sidecar 在 `SMDC_RUNTIME_PROBE` 启用时还会返回 `runtimeProbe` 字段，包含 Frida 环境的预检状态。

### `capture_started`

采集会话已创建。

**请求**:
```json
{
  "requestId": "req-1718000000002-2",
  "command": "start_capture",
  "payload": {
    "captureType": "alliance_data"
  }
}
```

**响应**:
```json
{
  "type": "capture_started",
  "requestId": "req-1718000000002-2",
  "sessionId": "preview-1718000000003-1",
  "status": "running",
  "message": "preview capture started for alliance_data",
  "payload": {
    "collectorMode": "preview",
    "captureType": "alliance_data",
    "flow": "alliance_runtime",
    "expectedArtifacts": ["rpc_dump", "ui_snapshot", "static_config"],
    "navigation": ["..."],
    "nextProbe": "__install_alliance_rpc_hooks__"
  }
}
```

`sessionId` 前缀规则：
- `preview-` : preview 模式 (dry-run, 无实际 Frida attach)
- `runtime-` : runtime_probe 模式 (实际 Frida 采集)

### `capture_log`

采集过程中的日志/元数据事件。

```json
{
  "type": "capture_log",
  "requestId": "req-1718000000002-2",
  "sessionId": "preview-1718000000003-1",
  "status": "info",
  "message": "preview capture log for alliance_data",
  "payload": {
    "nextProbe": "__install_alliance_rpc_hooks__"
  }
}
```

当 runtime probe 失败时，`status` 为 `"error"`，`payload` 包含错误信息。

### `capture_result`

采集完成的最终结果。**这是 Rust 端等待的终止事件**。

```json
{
  "type": "capture_result",
  "requestId": "req-1718000000002-2",
  "sessionId": "preview-1718000000003-1",
  "status": "completed",
  "message": "preview capture completed for alliance_data",
  "payload": {
    "collectorMode": "preview",
    "captureType": "alliance_data",
    "collectorPayload": {
      "collectorMode": "preview",
      "captureType": "alliance_data",
      "flow": "alliance_runtime",
      "expectedArtifacts": ["rpc_dump", "ui_snapshot", "static_config"],
      "navigation": ["..."],
      "preview": {
        "memberCount": 0,
        "buildingCount": 0,
        "logEntryCount": 0
      }
    }
  }
}
```

**Runtime probe 成功时**，`payload` 额外包含：
- `collectorPayload.runtime`: 含 `mode`, `source`, `artifactType`, `capturedAt`, `recordCount`
- `collectorPayload.evidence`: 原始证据数组 (RPC dump 记录摘要)

**Runtime probe 失败时**，`status` 为 `"failed"`，`payload` 仍包含可用的 preview 数据作为回退。

### `stopped`

响应 `stop` 命令的确认。

```json
{
  "type": "stopped",
  "requestId": "req-1718000000004-3",
  "status": "ok",
  "message": "collector stopped"
}
```

收到此事件后 sidecar 进程退出。

### `error`

通用错误事件。

```json
{
  "type": "error",
  "requestId": "req-1718000000005-4",
  "status": "error",
  "message": "unknown command: invalid_cmd"
}
```

当 `requestId` 匹配当前等待的请求，或 `requestId` 为 null 时，Rust 端将其视为错误并终止等待。

## 会话生命周期

```
┌─────────┐                    ┌──────────────┐
│  Rust   │                    │   Sidecar    │
│ 主进程   │                    │   (子进程)    │
└────┬────┘                    └──────┬───────┘
     │                                │
     │  启动子进程                     │
     │ ────────────────────────────── │
     │                                │ 初始化
     │   ◄──── hello ──────────────── │
     │                                │
     │   status ────────────────────► │
     │   ◄──── status ────────────── │ poll 状态
     │                                │
     │   start_capture ─────────────► │
     │   ◄──── capture_started ────── │ 创建会话
     │   ◄──── capture_log ────────── │ 日志
     │   ◄──── capture_result ─────── │ 完成 (终止事件)
     │                                │
     │   start_capture ─────────────► │ 可再次采集
     │   ...                          │
     │                                │
     │   stop ──────────────────────► │
     │   ◄──── stopped ────────────── │
     │                                │ 退出进程
     X          (进程结束)             X
```

## Rust 端处理逻辑 (collector.rs)

### request_until 循环

Rust 的 `request_until(command, payload, terminal_kinds)` 方法：

1. 确保 sidecar 进程在运行 (`ensure_running`)
2. 生成 `requestId`，构造 JSON 请求，写入 stdin
3. 循环读取 stdout：
   - 跳过 `hello` 事件
   - 遇到 `error` 事件 (requestId 匹配) → 返回 `Err`
   - 遇到事件类型在 `terminal_kinds` 中且 requestId 匹配 → 返回 `Ok`
   - 其他事件忽略
4. 如果 stdout 关闭 → 重置子进程，返回 `Err`

### 进程管理

- `ensure_running()`: 检查子进程存活，不存活则重新 spawn
- `spawn_process()`: 启动 Python 解释器或 Rust native sidecar
- `stop_capture()` / `shutdown()`: 若已登记 sidecar pid，则**立即** `kill_process_tree()`（Windows: `taskkill /T /F`）并 `reset()`；未登记时走 `stop_process()`，同样按进程树回收
- `reset()`: **必须按进程树杀**（`kill_process_tree` + `kill` + `wait`），因为 sidecar 会派生 frida 扫描子进程；只杀父进程会把扫描进程留成孤儿，而 reset 恰好最常在「探针超时/卡住」时被调用，每次重试都会再叠加一个
- sidecar 侧 `stop` / stdin EOF: 设置扫描中断标志并回收扫描子进程树后再返回（历史实现只 `return 0`，扫描进程会被留在系统里）
- 请求占位（2026-09-20 修复）：`request_in_flight` 是**同一时刻只允许一个请求持有 stdout channel** 的互斥标志。`status()` 用 `try_lock` + 在同一把锁内占位；`start_capture()` 用带 2s 上限的轮询等待占位。此前 status 只在锁外读标志就放锁，窗口期内 capture 抢先取走 `line_rx` 后，status 会取到 `None` 并触发 `reset()`，把进行中的采集一起杀掉
- `active` 原子标志: 防止并发采集

### CollectorCaptureAck

`start_capture` 返回的 `CollectorCaptureAck` 被 `db.rs::finish_capture_session` 消费：

```rust
pub struct CollectorCaptureAck {
    pub status: Option<String>,      // "completed" | "failed"
    pub session_id: Option<String>,  // preview-xxx 或 runtime-xxx
    pub message: String,
    pub payload: Option<Value>,      // capture_result 的完整 payload
}
```

## Capture Type 解析

| 请求值 | 解析结果 | Flow |
|--------|----------|------|
| `"alliance_data"` | `alliance_data` | `alliance_runtime` |
| `"battle_passive"` | `battle_passive` | `battle_listener` |
| 其他/空 | `alliance_data` (fallback) | `alliance_runtime` |

## Manifest 驱动

Sidecar 的 flow 元数据全部来自 `collector_manifest.json`。Manifest 定义：

- `manifestVersion`: 版本标识
- `captureFlows.<type>`: 每个采集流程的定义
  - `flow`: 流程名称 (如 `alliance_runtime`)
  - `handler`: Python 模块路径 (如 `flows.alliance_data`)
  - `expectedArtifacts`: 预期产出物列表
  - `navigation`: UI 导航路径
  - `nextProbe` / `dumpProbe` / `dumpProbes`: Frida hook 安装指令
  - `installPreludeProbes`: 前置 Lua require 指令
  - `installSeconds` / `dumpSeconds` / `triggerWaitSeconds`: 超时控制
  - `maxLuaStringBytes` / `maxHookBytes`: 内存限制

## Python Sidecar 的特殊行为

当 `SMDC_RUNTIME_PROBE` 启用时，Python sidecar 的 `handle_start_capture` 会：

1. 调用 `start_probe(capture_type, handler.definition)` 实际运行 Frida 扫描
2. 调用 `handler.build_runtime_capture_payload()` 将 Frida 结果注入 payload
3. 返回包含 `runtime` 和 `evidence` 字段的 `capture_result`

当 Frida 不可用或失败时，回退到 preview payload (dry-run)。
