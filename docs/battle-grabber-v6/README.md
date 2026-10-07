# 战报提取器 V6

基于 Tauri + React + Rust 构建的现代化战报提取工具。

## 特性

- ⚡ **极速启动** - exe 仅 3-5MB，启动时间 < 1 秒
- 🎨 **现代 UI** - React + TailwindCSS，流畅 60fps 动画
- 🔌 **Frida 集成** - 直接连接游戏进程，捕获协议数据
- 📊 **战报详情** - 胜负、双方阵容、红度、战损、战法、韬略、装备/马匹特技特效集中展示
- 📁 **多格式导出** - 保留 TXT/MD/CSV/JSON/HTML，并新增适合 AI 阅读的 `.battle.json` / `.battle.md`
- 🗄️ **战报库** - 单份战报优先留档，空会话默认折叠为诊断记录
- 🛡️ **同盟战报** - 1004/1007 被动监听、跨会话去重、CSV 批量导出与阵容表现/对阵汇总

## 系统要求

- Windows 10/11 (64-bit)
- Node.js 18+
- Rust 1.70+ (仅开发需要)

## 开发环境搭建

### 1. 安装依赖

```bash
# 安装前端依赖
npm install

# 或使用 yarn
yarn install

# 或使用 pnpm
pnpm install
```

### 2. 开发模式运行

```bash
# 启动开发服务器
npm run tauri dev

# 或
yarn tauri dev

# 或
pnpm tauri dev
```

### 3. 构建发布版

```bash
# 构建 exe
npm run tauri build

# 或
yarn tauri build

# 或
pnpm tauri build
```

构建完成后，exe 文件位于 `src-tauri/target/release/` 目录。

## 项目结构

```
battle_grabber_v6/
├── src/                    # React 前端
│   ├── components/         # UI 组件
│   ├── features/           # 功能模块
│   ├── stores/             # 状态管理
│   ├── lib/                # 工具库
│   └── styles/             # 样式文件
│
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── commands/       # Tauri 命令
│   │   ├── state.rs        # 状态管理
│   │   └── utils/          # 工具模块
│   └── Cargo.toml          # Rust 依赖
│
├── package.json            # Node.js 依赖
├── tailwind.config.js      # TailwindCSS 配置
├── vite.config.ts          # Vite 配置
└── README.md
```

## 使用说明

### 1. 连接游戏

1. 启动游戏
2. 打开战报提取器
3. 在"采集连接"页面选择游戏进程
4. 点击"连接"

### 2. 捕获战报

1. 连接游戏后，在游戏中进入战斗或查看战报详情
2. 程序会被动监听协议数据
3. 看到 1008 战报详情后，会自动生成单份报告并写入战报库
4. 点击"断开"结束监听

### 3. 查看战报

1. 切换到"战报库"页面
2. 选择一份战报
3. 进入"战报详情"查看胜负、阵容、红度、战损和结构化明细

### 4. 导出报告

每份 1008 战报会在报告目录自动生成：

- `*.readable.txt/md/csv/json/html`：兼容旧的人类可读和调试文件
- `*.battle.json`：最完整的结构化 AI 输入，包含 summary、battleDetails、events 和原始 payload
- `*.battle.md`：适合人和 AI 快速阅读的战报摘要，包含双方阵容、红度、战法、韬略、装备/马匹特技特效

### 5. 同盟战报协议监听

1. 切换到"同盟战报"页面
2. 点击"开始监听"后浏览同盟战报列表，程序会监听 1004/1007 协议包
3. 在游戏里手动翻页或展开连战分组，触发请求后会自动落盘与去重
4. 可在同盟页导出当前历史为 CSV，并查看阵容表现与对阵汇总
5. 原始 decoded 包与结构化记录会保存到 `output/<session>/alliance_protocol/`

## 配置说明

配置文件位于 `config.json`，主要配置项：

```json
{
  "gameProcessFuzzy": "nslg",        // 游戏进程模糊匹配
  "outputDir": "output",              // 输出目录
  "frida": {
    "hookScript": "frida_passive_battle_capture.js",  // Hook 脚本
    "reconnect": {
      "maxRetries": 5,                // 最大重试次数
      "baseDelaySec": 3               // 重连延迟
    }
  },
  "report": {
    "includeRawJson": true,
    "includeHtml": true
  }
}
```

## 快捷键

- `Ctrl + S` - 保存当前战报
- `Ctrl + E` - 导出报告
- `Ctrl + R` - 刷新战报
- `Ctrl + ,` - 打开设置
- `F5` - 刷新连接状态

## 常见问题

### Q: 连接游戏失败？

A: 确保：
1. 游戏已启动
2. 以管理员权限运行战报提取器
3. 防火墙没有阻止连接

### Q: 捕获不到事件？

A: 检查：
1. Frida 是否正确安装
2. Hook 脚本是否存在
3. 游戏进程是否正确识别

### Q: 为什么同盟战报不自动翻页？

A: 同盟战报保持手动操作 + 被动监听。请在游戏里手动翻页或展开连战分组，工具只负责监听 1004/1007 协议、落盘和去重。

## 技术栈

- **前端**: React 18 + TypeScript + TailwindCSS + Zustand + Recharts
- **后端**: Rust + Tauri 1.5
- **构建**: Vite 5
- **数据库**: SQLite (rusqlite)

## 许可证

MIT License
