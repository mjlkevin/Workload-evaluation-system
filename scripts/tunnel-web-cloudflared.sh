#!/usr/bin/env bash
set -euo pipefail

# Cloudflare Quick Tunnel。用法：npm run tunnel:web（须先 dev:web；页面 /api 由 Next 反代至本机 API）
#
# 浏览器访问公网页时，请求 /api/*、/downloads/* 由 Next rewrites 转到本机 API（见 ui/V0_SAAS/next.config.mjs），
# 一般只需映射前端即可联调页面；直连 API 再开一条 API 隧道。
#
# 若 Webpack HMR 在公网域名下异常，可重启 dev:web 前设置：
#   NEXT_ALLOWED_DEV_ORIGINS=<trycloudflare 子域，不含 https://>
#
# DNS / Error 1033 说明同 scripts/tunnel-api-cloudflared.sh

PORT="${WEB_PORT:-3001}"
TARGET="http://127.0.0.1:${PORT}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "未找到 cloudflared。macOS 安装示例: brew install cloudflare/cloudflare/cloudflared"
  echo "其它平台: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

echo "[tunnel:web] 转发 ${TARGET} → trycloudflare"
echo "[tunnel:web] 页面内 /api 反代至本机 API（127.0.0.1:3000），须保持 dev:api 已启动。"
echo "[tunnel:web] 按 Ctrl+C 停止。"
exec cloudflared tunnel --url "${TARGET}"
