#!/usr/bin/env bash
set -euo pipefail

# ngrok → 本机 Next（默认 3001）。先 dev:web，再 npm run tunnel:web:ngrok
#
# 安装与 token 同 scripts/tunnel-api-ngrok.sh
PORT="${WEB_PORT:-3001}"

if ! command -v ngrok >/dev/null 2>&1; then
  echo "未找到 ngrok。安装与 token 见 scripts/tunnel-api-ngrok.sh"
  echo "  或改用: npm run tunnel:web（Cloudflare） / npm run tunnel:web:lt"
  exit 1
fi

echo "[tunnel:web/ngrok] 转发 http://127.0.0.1:${PORT} → 公网（须保持 dev:api 已启动以便 /api 反代）"
echo "[tunnel:web/ngrok] 状态页: http://127.0.0.1:4040"
exec ngrok http "$PORT"
