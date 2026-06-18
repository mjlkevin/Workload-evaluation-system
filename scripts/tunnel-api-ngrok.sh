#!/usr/bin/env bash
set -euo pipefail

# ngrok HTTP 隧道（备选）。先 dev:api，再 npm run tunnel:api:ngrok
#
# 安装: brew install ngrok/ngrok/ngrok
# 首次: ngrok config add-authtoken <https://dashboard.ngrok.com/get-started/your-authtoken>
# ngrok v3 会自动选低延迟区域；若要固定区域可编辑 ~/.config/ngrok/ngrok.yml 中的 region。

PORT="${PORT:-3000}"

if ! command -v ngrok >/dev/null 2>&1; then
  echo "未找到 ngrok。"
  echo "  macOS: brew install ngrok/ngrok/ngrok"
  echo "  首次: ngrok config add-authtoken <你的 token>"
  echo "  或改用: npm run tunnel:api（Cloudflare） / npm run tunnel:api:lt（localtunnel）"
  exit 1
fi

echo "[tunnel:api/ngrok] 转发 http://127.0.0.1:${PORT} → 公网"
echo "[tunnel:api/ngrok] 公网 URL 见下方；也可打开 http://127.0.0.1:4040 查看请求"
echo "[tunnel:api/ngrok] 健康检查: curl -sS \"<公网根>/api/v1/health\""
exec ngrok http "$PORT"
