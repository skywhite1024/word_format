#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo ""
echo "========================================"
echo "  Word Format - Local Server"
echo "========================================"
echo ""

if ! command -v node &>/dev/null; then
    echo "  [ERROR] Node.js not found."
    echo "  Please install from https://nodejs.org"
    read -p "  Press Enter to exit..."
    exit 1
fi

echo "  [OK] Node.js: $(node -v)"

if [ ! -d "node_modules" ]; then
    echo "  [..] First run, installing dependencies..."
    npm install --production=false
    echo "  [OK] Dependencies installed."
else
    echo "  [OK] Dependencies ready."
fi

echo ""
echo "  [..] Starting local server..."
echo ""

node node_modules/tsx/dist/cli.mjs src/local-server.ts
