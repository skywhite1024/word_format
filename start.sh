#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║     Word Format - 文档格式解析 所见即所得      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# 检查 Node.js
if ! command -v node &>/dev/null; then
    echo "[错误] 未检测到 Node.js，请先安装 Node.js (https://nodejs.org)"
    echo "       建议安装 LTS 版本。"
    read -p "按回车键退出..."
    exit 1
fi

echo "[√] Node.js 版本: $(node -v)"

# 检查并安装依赖
if [ ! -d "node_modules" ]; then
    echo "[..] 首次运行，正在安装依赖..."
    npm install --production=false
    echo "[√] 依赖安装完成。"
else
    echo "[√] 依赖已就绪。"
fi

echo ""
echo "[..] 正在启动本地服务..."
echo ""

# 启动本地服务器
node node_modules/tsx/dist/cli.mjs src/local-server.ts
