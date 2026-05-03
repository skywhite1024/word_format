@echo off
title Word Format Local Server
cd /d "%~dp0"

echo.
echo  ========================================
echo   Word Format - Local Server
echo   https://word-format.aa15859014090.workers.dev/
echo  ========================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found.
    echo  Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  [OK] Node.js: %NODE_VER%

if not exist "node_modules" (
    echo  [..] First run, installing dependencies...
    call npm install --production=false
    if %errorlevel% neq 0 (
        echo  [ERROR] npm install failed. Please check your network.
        pause
        exit /b 1
    )
    echo  [OK] Dependencies installed.
) else (
    echo  [OK] Dependencies ready.
)

echo.
echo  [..] Starting local server...
echo.

node node_modules\tsx\dist\cli.mjs src\local-server.ts

if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Server failed to start.
    pause
)
