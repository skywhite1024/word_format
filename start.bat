@echo off
chcp 65001 >nul 2>&1
title Word Format 本地服务
cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════════╗
echo ║     Word Format - 文档格式解析 所见即所得      ║
echo ╚══════════════════════════════════════════════╝
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js ^(https://nodejs.org^)
    echo        建议安装 LTS 版本，安装后重新双击此文件。
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [√] Node.js 版本: %NODE_VER%

:: 检查并安装依赖
if not exist "node_modules" (
    echo [..] 首次运行，正在安装依赖...
    call npm install --production=false
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败，请检查网络连接。
        pause
        exit /b 1
    )
    echo [√] 依赖安装完成。
) else (
    echo [√] 依赖已就绪。
)

echo.
echo [..] 正在启动本地服务...
echo.

:: 启动本地服务器
node node_modules\tsx\dist\cli.mjs src\local-server.ts

if %errorlevel% neq 0 (
    echo.
    echo [错误] 服务启动失败。请确保已运行 npm install 安装依赖。
    pause
)
