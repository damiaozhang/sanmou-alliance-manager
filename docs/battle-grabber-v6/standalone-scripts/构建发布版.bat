@echo off
echo ========================================
echo   战报提取器 V6 - 构建发布版
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 18+
    pause
    exit /b 1
)

:: 检查 Rust
where rustc >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Rust，请先安装 Rust
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

:: 构建前端
echo [步骤 2/3] 构建前端...
call npm run build
if %errorlevel% neq 0 (
    echo [错误] 前端构建失败
    pause
    exit /b 1
)
echo.

:: 构建 Tauri
echo [步骤 3/3] 构建 Tauri 应用...
echo.
echo ========================================
echo   正在构建...
echo   首次构建可能需要 10-20 分钟
echo ========================================
echo.

call npm run tauri build
if %errorlevel% neq 0 (
    echo [错误] 构建失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo   构建完成！
echo.
echo   exe 文件位置:
echo   src-tauri\target\release\战报提取器V6.exe
echo.
echo   安装包位置:
echo   src-tauri\target\release\bundle\
echo ========================================
echo.

:: 打开输出目录
explorer src-tauri\target\release

pause
