#!/usr/bin/env bash
# ============================================================
# 本地带 DB 测试验证配方（阶段 2 §4.9 C11 方式②的可执行形态）
# ============================================================
# 背景（两条硬事实，缺一即验的是别的东西）：
#  1) C11 双 URL：DEF-2026-08-27-004 修复合入前，本地带 DB 测试存在库指向
#     分裂——repo 注入 TEST_DATABASE_URL，而 makeSession/usecase 走默认 db
#     单例（DATABASE_URL）。只设一个就会把测试夹具写进开发库 workload_eval。
#     本脚本把 DATABASE_URL 与 TEST_DATABASE_URL **同时**指向测试库，
#     仅经进程级环境变量注入，不改动任何 .env 文件。
#  2) 真 node：IDE 内置 shell 的 `node` 可能是 Electron shim
#     （process.versions.electron 有值、通常不带 npm），它加载不了原生绑定，
#     报错会被误判为 `@node-rs/jieba` 模块损坏（阶段 2 S3 commit c8fb32d 的
#     message 即有此误归因，更正登记在计划文档 §10「S3 合入登记」行）。
#     本脚本显式解析真 node 并拒绝 Electron shim。
#
# 用法：
#   bash scripts/verify-local-db-tests.sh                       # 无参 = 打印自检信息
#   bash scripts/verify-local-db-tests.sh test:modules:serial-store
#   bash scripts/verify-local-db-tests.sh test:modules test:ai test:harness
#   bash scripts/verify-local-db-tests.sh src/modules/modules.handlers.test.ts   # 单文件
#
# 可覆盖项（默认值面向本机 PostgreSQL 17）：
#   WES_TEST_DB_URL   测试库连接串（默认 postgres://kevin@localhost:5432/workload_eval_test）
#   WES_REAL_NODE     真 node 路径（默认按 nvm 版本目录探测，再回退 PATH 上的 node）
#   WES_API_DIR       apps/api 目录（默认 git 顶层目录下 apps/api，worktree 内执行即取该 worktree）
#   WES_KEEP_LOGS     日志目录（默认 /tmp/wes-local-db-tests）
#
# 退出码：任一套件失败即非 0（逐套件汇总后返回首个失败码）。
# ============================================================
set -u

TEST_DB_URL="${WES_TEST_DB_URL:-postgres://kevin@localhost:5432/workload_eval_test}"
LOG_DIR="${WES_KEEP_LOGS:-/tmp/wes-local-db-tests}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
API_DIR="${WES_API_DIR:-${REPO_ROOT:+$REPO_ROOT/apps/api}}"

die() { echo "FATAL: $*" >&2; exit 2; }

# ── 1. 定位真 node（拒绝 Electron shim）──────────────────────
resolve_node() {
  local cand
  if [ -n "${WES_REAL_NODE:-}" ]; then
    cand="$WES_REAL_NODE"
    is_real_node "$cand" && { echo "$cand"; return 0; }
    die "WES_REAL_NODE=$cand 不是真 node（疑似 Electron shim 或不存在）"
  fi
  for cand in "$HOME"/.nvm/versions/node/*/bin/node; do
    [ -x "$cand" ] && is_real_node "$cand" && { echo "$cand"; return 0; }
  done
  cand="$(command -v node 2>/dev/null || true)"
  if [ -n "$cand" ] && is_real_node "$cand"; then echo "$cand"; return 0; fi
  die "未找到真 node：nvm 版本目录下无可用 node，PATH 上的 node 是 Electron shim 或不存在"
}

is_real_node() {
  [ -x "$1" ] || return 1
  "$1" -e 'process.exit(process.versions.electron ? 1 : 0)' >/dev/null 2>&1
}

NODE_BIN="$(resolve_node)" || exit 2

# ── 2. 前置检查 ─────────────────────────────────────────────
[ -n "$API_DIR" ] && [ -d "$API_DIR" ] || die "找不到 apps/api（设 WES_API_DIR 或在仓库内执行）"
# tsx 从 apps/api 逐级往上找 node_modules（兼容 worktree 根 node_modules 软链）
TSX_CLI=""
probe="$API_DIR"
while [ "$probe" != "/" ] && [ -n "$probe" ]; do
  cand_nm="$probe/node_modules/tsx/dist/cli.mjs"
  if [ -f "$cand_nm" ]; then TSX_CLI="$cand_nm"; break; fi
  probe="$(dirname "$probe")"
done
[ -n "$TSX_CLI" ] || die "找不到 tsx（先在仓库根跑 npm install）"
PKG_JSON="$API_DIR/package.json"
[ -f "$API_DIR/test-setup.mts" ] || die "找不到 $API_DIR/test-setup.mts（global setup 守卫所在，缺失即无法保证 C11）"

# C10 对齐：在役存储开关从 ci.yml 的 test-with-db job env 段实取，不手抄
CI_YML="${REPO_ROOT:+$REPO_ROOT/.github/workflows/ci.yml}"
STORE_FLAGS=""
if [ -n "$CI_YML" ] && [ -f "$CI_YML" ]; then
  STORE_FLAGS="$("$NODE_BIN" -e '
    const fs = require("fs");
    const text = fs.readFileSync(process.argv[1], "utf-8");
    const keys = [...text.matchAll(/^\s{6}(WES_STORE_[A-Z_]+_PG):\s*"?true"?\s*$/gm)].map((m) => m[1]);
    process.stdout.write([...new Set(keys)].join(" "));
  ' "$CI_YML")"
fi
[ -n "$STORE_FLAGS" ] || echo "WARN: 未从 ci.yml 解析到在役 WES_STORE_*_PG 开关，本次将用当前环境值（C10 不齐 = 验的不是 CI 同一条路径）" >&2

mkdir -p "$LOG_DIR"

echo "node      = $NODE_BIN ($("$NODE_BIN" -v))"
echo "api dir   = $API_DIR"
echo "db url    = $TEST_DB_URL  (DATABASE_URL 与 TEST_DATABASE_URL 同指，C11 方式②)"
echo "store flags = ${STORE_FLAGS:-<none>}"
echo "logs      = $LOG_DIR"
echo

[ $# -eq 0 ] && { echo "无参数：仅完成自检。要跑套件请把 npm script 名或 src/ 下的测试文件作为参数传入。"; exit 0; }

# ── 3. 逐项执行 ─────────────────────────────────────────────
export DATABASE_URL="$TEST_DB_URL"
export TEST_DATABASE_URL="$TEST_DB_URL"
for kv in $STORE_FLAGS; do export "$kv=true"; done

run_npm_script() {
  local name="$1" args
  args="$("$NODE_BIN" -e '
    // 注：`node -e` 的 process.argv 是 [execPath, ...用户参数]，**没有脚本文件名占位**，
    // 故只跳一格。曾误写 [,, file, name] 使 file 拿到 name 的值，npm script 分支
    // 全部误报「未知 npm script」（单文件分支不走此路径，故未暴露）。
    const [, file, name] = process.argv;
    const s = require(file).scripts[name];
    if (!s) { process.exit(1); }
    process.stdout.write(s.replace(/^tsx\s+/, ""));
  ' "$PKG_JSON" "$name")" || { echo "=== $name: 未知 npm script ==="; return 1; }
  echo "=== npm run $name ==="
  ( cd "$API_DIR" && "$NODE_BIN" "$TSX_CLI" ${args} ) > "$LOG_DIR/$name.log" 2>&1
  local code=$?
  echo "exit=$code"
  grep -E '^(ℹ )?(tests|suites|pass|fail|cancelled|skipped|todo)\b' "$LOG_DIR/$name.log" | tail -8
  [ $code -ne 0 ] && grep -E '^\s*✖' "$LOG_DIR/$name.log" | head -20
  return $code
}

run_files() {
  local files="$*" slug
  slug="$(echo "$files" | tr ' /' '__' | cut -c1-80)"
  echo "=== 单文件（串行 --test-concurrency=1）：$files ==="
  ( cd "$API_DIR" && "$NODE_BIN" "$TSX_CLI" --test --test-global-setup=./test-setup.mts \
      --test-concurrency=1 $files ) > "$LOG_DIR/files-$slug.log" 2>&1
  local code=$?
  echo "exit=$code"
  grep -E '^(ℹ )?(tests|pass|fail|cancelled|skipped|todo)\b' "$LOG_DIR/files-$slug.log" | tail -8
  [ $code -ne 0 ] && grep -E '^\s*✖' "$LOG_DIR/files-$slug.log" | head -20
  return $code
}

RC=0
FILE_ARGS=()
for arg in "$@"; do
  case "$arg" in
    test:*|test*) if ! run_npm_script "$arg"; then RC=1; fi ;;
    *) FILE_ARGS+=("$arg") ;;
  esac
done
if [ ${#FILE_ARGS[@]} -gt 0 ]; then
  run_files "${FILE_ARGS[@]}" || RC=1
fi

echo
if [ "$RC" -eq 0 ]; then
  echo "ALL GREEN — 逐套件 fail/skipped 见上方计数（skipped ≠ 0 按 §十一 口径等同失败）"
else
  echo "FAILED — 详见 $LOG_DIR/*.log"
fi
exit $RC
