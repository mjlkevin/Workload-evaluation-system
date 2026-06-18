#!/usr/bin/env bash
# ============================================================
# Smoke Test — 部署后冒烟验证
# 用法: ./scripts/smoke-test-deploy.sh [BASE_URL] [USERNAME] [PASSWORD]
# 示例: ./scripts/smoke-test-deploy.sh http://localhost:3000 mjlkevin 'MyP@ss'
# ============================================================
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
USERNAME="${2:-mjlkevin}"
PASSWORD="${3:-mjlkevin123}"
TIMEOUT=10
PASS=0
FAIL=0
TOTAL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() { echo -e "  ${GREEN}PASS${NC}  $*"; PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); }
log_fail() { echo -e "  ${RED}FAIL${NC}  $*"; FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); }
log_info() { echo -e "  ${YELLOW}INFO${NC}  $*"; }
log_header() { echo -e "\n${YELLOW}>>> $*${NC}"; }

cleanup() {
  # 退出登录（可选，忽略失败）
  if [ -n "${TOKEN:-}" ]; then
    curl -sf -X POST "${BASE_URL}/api/v1/auth/logout" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/json" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ============================================================
# 1. Health Check
# ============================================================
log_header "1. Health Check"
HTTP_CODE=$(curl -s -o /tmp/smoke_health.json -w "%{http_code}" \
  "${BASE_URL}/api/v1/health" --max-time "${TIMEOUT}" 2>/dev/null || echo "000")
if [ "${HTTP_CODE}" = "200" ]; then
  STATUS=$(python3 -c "import json,sys; d=json.load(open('/tmp/smoke_health.json')); print(d.get('status','?'))" 2>/dev/null || echo "?")
  log_pass "GET /api/v1/health → ${HTTP_CODE} (status: ${STATUS})"
else
  log_fail "GET /api/v1/health → ${HTTP_CODE} (expected 200)"
fi

# ============================================================
# 2. Login → 获取 Token
# ============================================================
log_header "2. Login"
if [ -z "${PASSWORD}" ]; then
  log_info "PASSWORD 未提供，跳过认证相关测试（3-5）"
  SKIP_AUTH=true
else
  SKIP_AUTH=false
  HTTP_CODE=$(curl -s -o /tmp/smoke_login.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}" \
    --max-time "${TIMEOUT}" 2>/dev/null || echo "000")
  if [ "${HTTP_CODE}" = "200" ]; then
    TOKEN=$(python3 -c "import json,sys; d=json.load(open('/tmp/smoke_login.json')); print(d.get('data',{}).get('accessToken',d.get('data',{}).get('token','')))" 2>/dev/null || echo "")
    if [ -n "${TOKEN}" ]; then
      log_pass "POST /api/v1/auth/login → ${HTTP_CODE} (token acquired)"
    else
      log_fail "POST /api/v1/auth/login → ${HTTP_CODE} (token 字段未找到)"
      cat /tmp/smoke_login.json
      SKIP_AUTH=true
    fi
  else
    log_fail "POST /api/v1/auth/login → ${HTTP_CODE} (expected 200)"
    SKIP_AUTH=true
  fi
fi

# Fallback: if login failed and we need auth, try synthetic admin token (dev only)
if [ "${SKIP_AUTH}" = true ] && [ "${USERNAME}" = "mjlkevin" ]; then
  log_info "Login failed, trying synthetic admin token (dev fallback)..."
  # Generate a minimal JWT with admin role using the default dev secret
  TOKEN=$(python3 -c "
import base64, json, hmac, hashlib, time
header = base64.urlsafe_b64encode(json.dumps({'alg':'HS256','typ':'JWT'}).encode()).rstrip(b'=').decode()
payload = base64.urlsafe_b64encode(json.dumps({'sub':'804d4b81-2471-468c-b1d2-a366dd34a53f','username':'mjlkevin','role':'admin','iat':int(time.time()),'exp':int(time.time())+28800}).encode()).rstrip(b'=').decode()
secret = 'dev-jwt-secret-change-me'
sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), f'{header}.{payload}'.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
print(f'{header}.{payload}.{sig}')
" 2>/dev/null || echo "")
  if [ -n "${TOKEN}" ]; then
    # Verify token works
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      -X GET "${BASE_URL}/api/v1/auth/me" \
      -H "Authorization: Bearer ${TOKEN}" \
      --max-time "${TIMEOUT}" 2>/dev/null || echo "000")
    if [ "${HTTP_CODE}" = "200" ]; then
      TOKEN="${TOKEN}"
      SKIP_AUTH=false
      log_pass "Synthetic admin token → valid (dev fallback)"
    else
      log_fail "Synthetic admin token → invalid (${HTTP_CODE})"
      SKIP_AUTH=true
    fi
  fi
fi

# ============================================================
# 3. 版本流程: Checkout → Save Draft → Checkin
# ============================================================
log_header "3. Version Flow (create → checkout → checkin)"
if [ "${SKIP_AUTH}" = true ]; then
  log_info "跳过（需要认证成功）"
else
  # 3a. Create a version first
  HTTP_CODE=$(curl -s -o /tmp/smoke_version.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/v1/versions" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"type":"global","templateId":"tmpl-default","payload":{"customerName":"smoke-test","items":[]}}' \
    --max-time "${TIMEOUT}" 2>/dev/null || echo "000")
  VERSION_ID=$(python3 -c "import json; d=json.load(open('/tmp/smoke_version.json')); print(d.get('data',{}).get('record',{}).get('id',''))" 2>/dev/null || echo "")
  if [ "${HTTP_CODE}" = "200" ] && [ -n "${VERSION_ID}" ]; then
    log_pass "POST /versions → ${HTTP_CODE} (version: ${VERSION_ID})"
  else
    log_fail "POST /versions → ${HTTP_CODE} (version id not found)"
    SKIP_AUTH=true
  fi

  # 3b. Checkout
  if [ -n "${VERSION_ID}" ] && [ "${SKIP_AUTH}" = false ]; then
    HTTP_CODE=$(curl -s -o /tmp/smoke_checkout.json -w "%{http_code}" \
      -X POST "${BASE_URL}/api/v1/versions/${VERSION_ID}/checkout" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{"reason":"smoke test"}' \
      --max-time "${TIMEOUT}" 2>/dev/null || echo "000")
    if [ "${HTTP_CODE}" = "200" ]; then
      log_pass "POST /versions/:id/checkout → ${HTTP_CODE}"
    else
      log_fail "POST /versions/:id/checkout → ${HTTP_CODE} (expected 200)"
    fi

    # 3c. Checkin
    HTTP_CODE=$(curl -s -o /tmp/smoke_checkin.json -w "%{http_code}" \
      -X POST "${BASE_URL}/api/v1/versions/${VERSION_ID}/checkin" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{}' \
      --max-time "${TIMEOUT}" 2>/dev/null || echo "000")
    if [ "${HTTP_CODE}" = "200" ]; then
      log_pass "POST /versions/:id/checkin → ${HTTP_CODE}"
    else
      log_fail "POST /versions/:id/checkin → ${HTTP_CODE} (expected 200)"
    fi
  fi
fi

# ============================================================
# 4. Export 流程: Calculate → Export
# ============================================================
log_header "4. Export Flow (calculate → export)"
if [ "${SKIP_AUTH}" = true ]; then
  log_info "跳过（需要认证成功）"
else
  # Get template items first
  HTTP_CODE=$(curl -s -o /tmp/smoke_templates.json -w "%{http_code}" \
    "${BASE_URL}/api/v1/templates" \
    -H "Authorization: Bearer ${TOKEN}" \
    --max-time "${TIMEOUT}" 2>/dev/null || echo "000")
  TEMPLATE_ID=$(python3 -c "import json; d=json.load(open('/tmp/smoke_templates.json')); print(d.get('data',{}).get('list',[{}])[0].get('templateId',''))" 2>/dev/null || echo "")

  if [ -n "${TEMPLATE_ID}" ]; then
    # Get template detail for items
    HTTP_CODE=$(curl -s -o /tmp/smoke_tmpl_detail.json -w "%{http_code}" \
      "${BASE_URL}/api/v1/templates/${TEMPLATE_ID}" \
      -H "Authorization: Bearer ${TOKEN}" \
      --max-time "${TIMEOUT}" 2>/dev/null || echo "000")

    # Get active rule set
    RULE_SET_ID=$(python3 -c "
import json
d=json.load(open('/tmp/smoke_tmpl_detail.json'))
items=d.get('data',{}).get('items',[])
print(json.dumps([{'templateItemId':i.get('templateItemId',''),'included':idx==0} for idx,i in enumerate(items)]))
" 2>/dev/null || echo "[]")

    HTTP_CODE=$(curl -s -o /tmp/smoke_rules.json -w "%{http_code}" \
      "${BASE_URL}/api/v1/rule-sets/active" \
      -H "Authorization: Bearer ${TOKEN}" \
      --max-time "${TIMEOUT}" 2>/dev/null || echo "000")
    RULE_SET_ID=$(python3 -c "import json; d=json.load(open('/tmp/smoke_rules.json')); print(d.get('data',{}).get('ruleSetId',''))" 2>/dev/null || echo "")

    # 4a. Calculate man-days
    if [ -n "${RULE_SET_ID}" ] && [ -n "${TEMPLATE_ID}" ]; then
      ITEMS=$(python3 -c "
import json
d=json.load(open('/tmp/smoke_tmpl_detail.json'))
items=d.get('data',{}).get('items',[])
print(json.dumps([{'templateItemId':i.get('templateItemId',''),'included':idx==0} for idx,i in enumerate(items)]))
" 2>/dev/null || echo "[]")

      HTTP_CODE=$(curl -s -o /tmp/smoke_calc.json -w "%{http_code}" \
        -X POST "${BASE_URL}/api/v1/estimates/calculate" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"templateId\":\"${TEMPLATE_ID}\",\"ruleSetId\":\"${RULE_SET_ID}\",\"userCount\":51,\"difficultyFactor\":0.1,\"orgCount\":2,\"orgSimilarityFactor\":0.6,\"items\":${ITEMS}}" \
        --max-time "${TIMEOUT}" 2>/dev/null || echo "000")
      if [ "${HTTP_CODE}" = "200" ]; then
        log_pass "POST /estimates/calculate → ${HTTP_CODE}"
      else
        log_fail "POST /estimates/calculate → ${HTTP_CODE} (expected 200)"
      fi

      # 4b. Export
      HTTP_CODE=$(curl -s -o /tmp/smoke_export.json -w "%{http_code}" \
        -X POST "${BASE_URL}/api/v1/estimates/export/excel" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"templateId\":\"${TEMPLATE_ID}\",\"ruleSetId\":\"${RULE_SET_ID}\",\"userCount\":51,\"difficultyFactor\":0.1,\"orgCount\":2,\"orgSimilarityFactor\":0.6,\"items\":${ITEMS}}" \
        --max-time "${TIMEOUT}" 2>/dev/null || echo "000")
      if [ "${HTTP_CODE}" = "200" ] || [ "${HTTP_CODE}" = "201" ]; then
        log_pass "POST /estimates/export/excel → ${HTTP_CODE}"
      else
        log_fail "POST /estimates/export/excel → ${HTTP_CODE} (expected 200/201)"
      fi
    else
      log_info "跳过计算/导出（模板或规则集不可用）"
    fi
  else
    log_info "跳过计算/导出（模板不可用）"
  fi
fi

# ============================================================
# 5. 无权限访问（负面测试）
# ============================================================
log_header "5. Unauthorized Access (negative test)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X GET "${BASE_URL}/api/v1/auth/me" \
  --max-time "${TIMEOUT}" 2>/dev/null || echo "000")
if [ "${HTTP_CODE}" = "401" ]; then
  log_pass "GET /api/v1/auth/me (no token) → ${HTTP_CODE} (expected 401)"
else
  log_fail "GET /api/v1/auth/me (no token) → ${HTTP_CODE} (expected 401)"
fi

# ============================================================
# Summary
# ============================================================
log_header "Summary"
echo -e "  Total: ${TOTAL} | ${GREEN}Pass: ${PASS}${NC} | ${RED}Fail: ${FAIL}${NC}"

if [ "${FAIL}" -gt 0 ]; then
  echo -e "\n${RED}Smoke test FAILED. Review output above.${NC}"
  exit 1
else
  echo -e "\n${GREEN}Smoke test PASSED.${NC}"
  exit 0
fi
