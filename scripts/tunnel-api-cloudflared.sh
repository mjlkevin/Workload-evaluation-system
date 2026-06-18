#!/usr/bin/env bash
set -euo pipefail

# Cloudflare Quick Tunnel（无账号临时 HTTPS）。用法：npm run tunnel:api（须先 dev:api）
# 备选：npm run tunnel:api:ngrok / tunnel:api:lt
# 端口与 API 一致，默认 3000；可与 API 共用 .env 中的 PORT。
#
# 若日志出现 argotunnel / trycloudflare 相关 DNS 超时，公网会报 Cloudflare Error 1033：
# 请把本机 DNS 改为 1.1.1.1 / 8.8.8.8，或换可访问 Cloudflare 的网络后再试。

PORT="${PORT:-3000}"
TARGET="http://127.0.0.1:${PORT}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "未找到 cloudflared。macOS 安装示例: brew install cloudflare/cloudflare/cloudflared"
  echo "其它平台: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

echo "[tunnel:api] 转发 ${TARGET} → trycloudflare（终端会打印 https://....trycloudflare.com）"
echo "[tunnel:api] 健康检查: curl -sS \"<公网根>/api/v1/health\""
echo "[tunnel:api] 须保持本进程运行；按 Ctrl+C 停止。"
exec cloudflared tunnel --url "${TARGET}"
