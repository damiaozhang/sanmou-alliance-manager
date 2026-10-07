@echo off
echo ========================================
echo   战报提取器 V6 - 开发环境启动
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 18+
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

:: 检查 Rust
where rustc >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Rust，请先安装 Rust
    echo 下载地址: https://rustup.rs/
    pause
    exit /b 1
)

echo [信息] Node.js 版本:
node --version
echo.
echo [信息] Rust 版本:
rustc --version
echo.

:: 安装依赖
echo [步骤 1/3] 安装前端依赖...
call npm install
if %errorlevel% neq 0 (
    echo [错误] 安装依赖失败
    pause
    exit /b 1
)
echo.

:: 启动开发服务器
echo [步骤 2/3] 启动开发服务器...
echo.
echo ========================================
echo   开发服务器启动中...
echo   首次启动可能需要几分钟编译 Rust
echo ========================================
echo.

call npm run tauri dev

pause
