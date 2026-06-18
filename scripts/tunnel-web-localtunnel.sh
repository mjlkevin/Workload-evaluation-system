#!/usr/bin/env bash
set -euo pipefail

# 见 tunnel-api-localtunnel.sh

PORT="${WEB_PORT:-3001}"
echo "[tunnel:web/lt] 端口 ${PORT}；须保持 dev:api 已启动"
exec npx --yes localtunnel --port "$PORT"
