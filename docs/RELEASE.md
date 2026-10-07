# 发布流程（Release Checklist）

三谋同盟管理助手 Windows 桌面端发布说明。CI 发布 job 定义在 `.github/workflows/ci.yml` 的 `release` job，
updater manifest 生成逻辑见 `scripts/generate-updater-manifest.mjs`。

玩家展示名称为「三谋同盟管理助手」。`productName` 保留 `Sanmou Ledger`，用于兼容既有安装包名与更新链接；窗口标题、首页及 Release 标题使用中文名。应用标识 `com.sanmou.alliance-manager` 保持稳定，以便继续访问旧版本地数据。

## 发布流程

1. **同步版本号（三处必须一致）**：
   - `package.json` 顶层 `version`
   - `src-tauri/tauri.conf.json` 顶层 `version`
   - `src-tauri/Cargo.toml` `[package]` 段的 `version`

   本地自检：`npm run check:version`（CI frontend 与 release job 也会强制检查）。

2. **打 tag 并推送**：

   ```powershell
   git tag v<version>   # 如 v0.2.0，必须与上面的版本号一致
   git push origin v<version>
   ```

3. **CI 自动构建**：推送 `v*` tag 触发 `release` job（先等 frontend / collector-python / backend 三个 job 通过）：
   - `npm ci` → `npm run check:version`
   - `python -m pip install pyinstaller frida` → `npm run bridge:build`（bridge exe 不入库，发版时现建）
   - `npm run tauri build` 生成 NSIS 安装包与 `.sig` updater 签名
   - `npm run release:manifest` 生成 `latest.json`
   - 创建 GitHub Release 并上传 `.exe`、`.exe.sig`、`latest.json`
     （幂等：Release 已存在时改用 `gh release upload --clobber` 覆盖资产）

4. **校验 latest.json**：发布完成后访问
   `https://github.com/damiaozhang/sanmou-alliance-manager/releases/latest/download/latest.json`，
   确认：
   - `version` 与 tag 一致
   - `platforms["windows-x86_64"].url` 指向本次 release 的安装包
   - `signature` 非空（来自安装包旁的 `.sig` 文件）

   已安装的旧版本客户端会在启动时通过 updater endpoint 检测到新版本。

> ⚠️ **安装包名里的空格会被 GitHub 改写**：产品名是 `Sanmou Ledger`，本地产物文件名含空格
> （`Sanmou Ledger_<version>_x64-setup.exe`），而 GitHub Releases 会把资源名中
> `[A-Za-z0-9._-]` 以外的字符替换为 `.`，实际存成 `Sanmou.Ledger_<version>_x64-setup.exe`。
> updater 会**原样下载** `latest.json` 里的 URL，因此
> `scripts/generate-updater-manifest.mjs` 必须先做同样的改写再拼 URL，否则更新链接 404。
> 发版后请用 `curl -sIL <url>` 确认返回 200。

## 发布前手动冒烟（真机）

打 tag 前在开发机跑一遍：

```powershell
# 桌面端 UI / 命令链路冒烟（需要本地已构建或可运行的桌面应用）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-desktop-app.ps1

# 真机采集链路冒烟：runtime-scan / sidecar / Frida 握手链路
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-runtime-chain.ps1
```

另建议本地先跑一遍 CI 等价检查：

```powershell
npx tsc --noEmit
npm run lint
npm run test:coverage   # 含覆盖率下限门槛
npm run check:version
```

## 密钥与 Secrets 配置

Tauri updater 使用 minisign 密钥对安装包签名：

- **公钥**：已写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，无需保密。
- **私钥**：绝不提交到仓库。本地密钥放在 `temp-keys/`（已 gitignore），
  线上通过 GitHub Secrets 注入。

在仓库 **Settings → Secrets and variables → Actions** 配置：

| Secret 名称 | 内容 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | updater 私钥文件全部内容（minisign 私钥） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥口令（无口令则留空字符串） |

本地手动打包时的等价做法（见 README「Windows 打包」）：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY=(Get-Content -Raw -Path '<release-signing-key>')
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD='<release-signing-key-password>'
```

> 注意：换密钥对时公钥（tauri.conf.json）与私钥（Secrets）必须同步更换，
> 否则旧客户端无法校验新包签名。

## 版本号需要同步的三处位置

| 文件 | 字段 |
| --- | --- |
| `package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| `src-tauri/Cargo.toml` | `[package]` 的 `version` |

安装包文件名、`latest.json` 中的下载 URL（`v<version>` tag）都由这三处版本号推导，
漏改任何一处都会被 `npm run check:version` 与 release job 拦截。
