#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_LOG="${ROOT_DIR}/logs/dev-api.log"
WEB_LOG="${ROOT_DIR}/logs/dev-web.log"

cd "${ROOT_DIR}"

echo "[recover] workspace: ${ROOT_DIR}"
echo "[recover] step 1/6 kill stale processes and ports"

# Stop common dev commands (ignore if not running).
pkill -f "npm run dev:api" >/dev/null 2>&1 || true
pkill -f "npm run dev:web" >/dev/null 2>&1 || true
pkill -f "tsx watch src/main.ts" >/dev/null 2>&1 || true
pkill -f "next dev -p 3001" >/dev/null 2>&1 || true
pkill -f "apps/api/dist/main.js" >/dev/null 2>&1 || true

# Ensure 3000/3001 are available.
for port in 3000 3001; do
  pid="$(lsof -t -iTCP:${port} -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -n "${pid}" ]]; then
    kill -9 "${pid}" >/dev/null 2>&1 || true
  fi
done

echo "[recover] step 2/6 clean stale caches"
rm -rf "${ROOT_DIR}/ui/V0_SAAS/.next" >/dev/null 2>&1 || true
rm -rf "${ROOT_DIR}/ui/V0_SAAS/.next/dev/cache" >/dev/null 2>&1 || true
rm -rf "${ROOT_DIR}/ui/V0_SAAS/node_modules.__broken_20260411" >/dev/null 2>&1 || true
rm -rf "${ROOT_DIR}/node_modules.__broken_20260411" >/dev/null 2>&1 || true

echo "[recover] step 3/6 reinstall root dependencies"
npm install

echo "[recover] step 4/6 reinstall frontend dependencies"
npm install --prefix ui/V0_SAAS

echo "[recover] step 5/6 start api/web in background"
mkdir -p "${ROOT_DIR}/logs"
nohup npm run dev:api >"${API_LOG}" 2>&1 &
API_PID=$!
nohup npm run dev:web >"${WEB_LOG}" 2>&1 &
WEB_PID=$!

echo "[recover] api pid=${API_PID}, web pid=${WEB_PID}"
echo "[recover] waiting for startup"
sleep 5

echo "[recover] step 6/6 verify health"
curl --noproxy "*" -sS -m 8 "http://127.0.0.1:3000/api/v1/health" >/dev/null
WEB_STATUS="$(curl --noproxy "*" -sS -m 12 -o /dev/null -w "%{http_code}" "http://localhost:3001" || true)"
if [[ "${WEB_STATUS}" != "200" && "${WEB_STATUS}" != "307" && "${WEB_STATUS}" != "308" ]]; then
  echo "[recover] web startup check failed, status=${WEB_STATUS}"
  echo "[recover] api log: ${API_LOG}"
  echo "[recover] web log: ${WEB_LOG}"
  exit 1
fi

echo "[recover] done"
echo "[recover] api health ok: http://127.0.0.1:3000/api/v1/health"
echo "[recover] web ready: http://localhost:3001"
echo "[recover] logs:"
echo "  - ${API_LOG}"
echo "  - ${WEB_LOG}"
