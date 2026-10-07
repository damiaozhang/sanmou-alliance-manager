# Sanmou Ledger 开发环境搭建

## 前置条件

| 工具 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | 18+ | 前端构建与 Tauri CLI |
| npm | 9+ | 随 Node.js 分发 |
| Rust | 1.77+ (stable) | 后端编译 |
| Python | 3.11+ | Sidecar 回退与 runtime scan |
| Git | 任意 | 版本管理 |

### Windows 额外要求

- **Windows 10/11** (x64)
- **Visual Studio Build Tools 2022** (含 C++ 桌面开发工作负荷) 或完整 Visual Studio
- **Windows 10/11 SDK** (通常随 VS 安装)

### 推荐安装

```powershell
# Rust (通过 rustup)
winget install --id Rustlang.Rustup

# Node.js
winget install --id OpenJS.NodeJS.LTS

# Python 3.11+
winget install python.python.3.12
```

## 克隆与安装

```bash
git clone <repo-url> sanmou-alliance-manager
cd sanmou-alliance-manager
npm install
```

`npm install` 会安装所有前端依赖和 Tauri CLI。

> ⚠️ **首次编译前必须先构建 bridge**：`src-tauri/assets/frida_bridge.exe` 是约 50MB 的
> PyInstaller 产物，不入库。`tauri-build` 会校验 `bundle.resources` 中每个路径是否存在，
> 缺文件会导致 `tauri dev` / `tauri build` / `cargo test` 一律编译失败。
>
> ```bash
> python -m pip install pyinstaller frida
> npm run bridge:build
> ```

## 开发工作流

### 启动开发模式

```bash
npm run tauri dev
```

这会：
1. 启动 Vite 开发服务器 (默认 `http://127.0.0.1:5173`)
2. 编译 Rust 后端 (debug 模式)
3. 启动 Tauri 窗口加载前端

**端口冲突处理**: 如果 5173 被占用，先单独启动 Vite：

```bash
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

然后修改 `src-tauri/tauri.conf.json` 中的 `build.devUrl` 为 `http://127.0.0.1:5174`，再运行 `npm run tauri dev`。

### 仅启动前端 (不启动 Tauri)

```bash
npm run dev
```

适用于调试 UI 问题，前端会使用 mock 数据。

### TypeScript 类型检查

```bash
npx tsc --noEmit
```

### Rust 代码检查

```bash
cd src-tauri
cargo check
cargo clippy
```

## 项目结构热力图

- **前端改动**: 编辑 `src/` 下的文件，Vite HMR 即时生效
- **Rust 改动**: 编辑 `src-tauri/src/` 下的文件，Tauri 会自动重新编译 (cargo build) 并重启应用
- **Python sidecar 改动**: 编辑 `collector/` 下的文件，重启应用后生效 (因为脚本在启动时写入 app data)

## 生产构建

### 构建 Windows 安装包

```powershell
# 设置代码签名私钥 (可选)
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -Raw -Path '<key-file>')
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<password>'

# 构建
npm run tauri build
```

构建产物：
- `src-tauri/target/release/bundle/nsis/Sanmou Ledger_<version>_x64-setup.exe`
- `src-tauri/target/release/bundle/nsis/Sanmou Ledger_<version>_x64-setup.exe.sig` (启用 updater 签名时)

### 构建 Frida Bridge

```bash
npm run bridge:build
```

编译独立的 `frida_bridge.exe` (包含 Python + Frida 环境)，打包到 Tauri bundle 资源中。

### 生成更新清单

```bash
npm run release:manifest
```

生成 `latest.json` 用于 Tauri updater 自动更新检测。

## Python Sidecar 配置

### Frida 安装

Runtime probe 需要 Frida 才能 attach 到目标进程：

```bash
pip install frida-tools
```

验证安装：

```bash
python -c "import frida; print(frida.__version__)"
```

### Runtime Scan 脚本

应用内置了 `collector/frida_nslg_runtime_scan.py`。启动时会自动复制到 app data 目录，无需手动部署。

### 调试覆盖 (仅开发环境)

```powershell
# 使用外部脚本 (调试)
$env:SMDC_RUNTIME_SCAN_ALLOW_EXTERNAL = "1"
$env:SMDC_RUNTIME_SCAN_SCRIPT = "C:\path\to\custom_scan.py"
$env:SMDC_RUNTIME_SCAN_CWD = "C:\path\to\working\dir"
```

**安全提示**: `SMDC_RUNTIME_SCAN_ALLOW_EXTERNAL` 仅在受控开发环境中使用，生产构建忽略此选项。

## 环境变量参考

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `SMDC_RUNTIME_PROBE` | 启用 runtime probe 模式 (`command` / `jsonl` / `1`) | 未设置 |
| `SMDC_RUNTIME_PROBE_JSONL` | JSONL 回放文件路径 (替代实际 Frida attach) | 未设置 |
| `SMDC_COLLECTOR_NATIVE_SIDECAR` | 优先使用 Rust native sidecar | 启动时自动设为 `1` |
| `SMDC_RUNTIME_SCAN_COMMAND` | 自定义 scan 命令 (需配合 `_ALLOW_EXTERNAL`) | 未设置 |
| `SMDC_RUNTIME_SCAN_PROCESS` | 目标进程名过滤 (需配合 `_ALLOW_EXTERNAL`) | `NSLG` |
| `SMDC_RUNTIME_SCAN_SCRIPT` | 自定义 scan 脚本路径 (需配合 `_ALLOW_EXTERNAL`) | 未设置 |
| `SMDC_RUNTIME_SCAN_CWD` | scan 脚本工作目录 (需配合 `_ALLOW_EXTERNAL`) | 未设置 |
| `SMDC_RUNTIME_SCAN_ALLOW_EXTERNAL` | 允许外部覆盖 scan 参数 (`1` 启用) | 未设置 |
| `BATTLE_GRABBER_V6_OUTPUT_ROOT` | 战报扫描 V6 输出目录 | `{app_data}/battle-grabber-v6/output` |
| `TAURI_SIGNING_PRIVATE_KEY` | 代码签名私钥路径 (构建用) | 未设置 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码 (构建用) | 未设置 |

## 调试技巧

### Rust 日志

应用使用 `env_logger`，可通过设置 `RUST_LOG` 环境变量开启：

```powershell
$env:RUST_LOG = "debug"
npm run tauri dev
```

### Sidecar 错误排查

Sidecar stderr 输出写入 `{app_data}/collector_sidecar.err.log`，可用于排查 Python 启动或运行时错误。

### 测试

```bash
# Rust 测试
cd src-tauri
cargo test

# 前端测试
npx vitest run
```

Rust 测试中包含 collector-sidecar 集成测试 (preview 和 runtime_probe 模式)，使用 `test-data/` 中的 JSONL 回放数据。
