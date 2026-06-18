#!/usr/bin/env bash
set -euo pipefail

# localtunnel：免注册，npx 即用；部分网络或自动化场景可能被插入验证页。
# 用法: npm run tunnel:api:lt

PORT="${PORT:-3000}"
echo "[tunnel:api/lt] 端口 ${PORT}；下方 your url is: 即为公网地址"
exec npx --yes localtunnel --port "$PORT"
