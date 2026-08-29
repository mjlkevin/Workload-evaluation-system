#!/usr/bin/env bash
# link-to-open-design.sh — 幂等地把 wes-workbench 包链接进本地 Open-Design 克隆。
# 用法：./link-to-open-design.sh [--no-guards]
set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../../../.." && pwd)"
OD_DIR="$REPO_ROOT/.codex-tools/open-design"
TARGET_DIR="$OD_DIR/design-systems/wes-workbench"
SCHEMA_FILE="$OD_DIR/packages/contracts/src/design-systems/token-schema.ts"
RUN_GUARDS=1
[ "${1:-}" = "--no-guards" ] && RUN_GUARDS=0

# 1) 复制包（同步覆盖，清理目标侧多余文件）
if [ ! -d "$OD_DIR/design-systems" ]; then
  echo "错误：未找到 $OD_DIR/design-systems，请先克隆 open-design 到 .codex-tools/open-design" >&2
  exit 1
fi
mkdir -p "$TARGET_DIR"
rsync -a --delete --exclude 'README.md' --exclude 'link-to-open-design.sh' "$PKG_DIR/" "$TARGET_DIR/"
echo "✅ 已同步包 → $TARGET_DIR"

# 2) 白名单注册检查（注册本身是一次性人工操作）
if grep -q '"wes-workbench"' "$SCHEMA_FILE" 2>/dev/null; then
  echo "✅ BRAND_EXTENSIONS 白名单已注册 wes-workbench"
else
  echo "⚠️ BRAND_EXTENSIONS 缺少 wes-workbench 注册（$SCHEMA_FILE），请人工补 28 个扩展 token 后再跑守卫" >&2
fi

# 3) 官方守卫
if [ "$RUN_GUARDS" -eq 0 ]; then exit 0; fi
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ] && [ -x "$HOME/.nvm/versions/node/v24.15.0/bin/node" ]; then
  NODE_BIN="$HOME/.nvm/versions/node/v24.15.0/bin/node"
fi
if [ -z "$NODE_BIN" ]; then
  echo "⚠️ 未找到 node，跳过守卫运行" >&2
  exit 0
fi
cd "$OD_DIR"
for g in check-tokens-fixture-sync.ts check-design-system-manifests.ts check-design-system-package-quality.ts; do
  "$NODE_BIN" "scripts/$g"
done
if [ -d "node_modules/@open-design" ] || [ -d "node_modules" ]; then
  "$NODE_BIN" scripts/check-design-system-flag-parity.ts || echo "⚠️ flag-parity 失败，检查依赖安装是否完整" >&2
else
  echo "⚠️ 无 node_modules，跳过 check-design-system-flag-parity（安装依赖后补跑）" >&2
fi
echo "✅ 守卫完成"
