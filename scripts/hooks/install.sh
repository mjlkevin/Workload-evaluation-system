#!/bin/sh
# Install WES git hooks into the repository's hooks directory.
# Works for both regular repos and worktrees (hooks live in common .git dir).
#
# ⚠️ 影响范围警告（2026-09-03 复核补打，长期生效）
# 本仓库 .git 由全部 worktree 共用：钩子写入 common hooks 目录后，对【全部
# worktree 与所有并行会话】的提交行为生效；未获知本规则的并行线提交时缺少
# Session: 尾行会被直接拒绝。因此：启用须经架构侧批准并通知各线。执行前
# 本脚本会打印将要修改的路径，并要求交互确认（输入 yes），或显式传 --yes。
# 另注意：钩子写入 common hooks 目录即已全仓生效，无需也不应另设
# core.hooksPath（2026-09-03 曾发生未授权全仓启用事故，处置见总看板台账）。
#
# Usage:
#   sh scripts/hooks/install.sh          # 交互确认（输入 yes）后安装
#   sh scripts/hooks/install.sh --yes    # 显式授权，跳过交互确认
#   sh scripts/hooks/install.sh -h       # 显示本用法

usage() {
  cat <<'EOF'
Usage:
  sh scripts/hooks/install.sh          # 交互确认（输入 yes）后安装
  sh scripts/hooks/install.sh --yes    # 显式授权，跳过交互确认
  sh scripts/hooks/install.sh -h       # 显示本用法

影响范围警告（2026-09-03 复核补打，长期生效）:
  本仓库 .git 由全部 worktree 共用，钩子写入 common hooks 目录后对全部
  worktree 与所有并行会话的提交行为生效。启用须经架构侧批准并通知各线；
  执行前本脚本会打印将要修改的路径，并要求交互确认或显式 --yes。
  钩子写入 common hooks 目录即已全仓生效，无需也不应另设 core.hooksPath。
EOF
}

CONFIRM_MODE="ask"
case "${1:-}" in
  --yes) CONFIRM_MODE="yes" ;;
  -h|--help) usage ; exit 0 ;;
  "") : ;;
  *) echo "Unknown argument: ${1}" >&2; usage >&2; exit 2 ;;
esac

COMMON_DIR="$(git rev-parse --git-common-dir)" || exit 1
HOOKS_DIR="$COMMON_DIR/hooks"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 打印将要修改的路径（安装前必示）
echo "⚠️  影响范围：本仓库全部 worktree 与所有并行会话（common .git 共享）"
echo "    将安装钩子到：${HOOKS_DIR}"
for hook in pre-commit commit-msg; do
  src="$SCRIPT_DIR/$hook"
  dst="$HOOKS_DIR/$hook"
  if [ -f "$src" ]; then
    echo "      - ${dst}  ← 来自 ${src}"
  else
    echo "      - ${dst}  ← 跳过（${src} 不存在）"
  fi
done
echo "    启用须经架构侧批准并通知各线。"

if [ "$CONFIRM_MODE" != "yes" ]; then
  printf '确认安装？输入 yes 继续，其余输入取消：'
  if ! read -r ans; then
    echo
    echo "非交互环境无法确认，已取消（如需跳过确认请显式传 --yes）"
    exit 3
  fi
  if [ "$ans" != "yes" ] && [ "$ans" != "YES" ]; then
    echo "已取消，未做任何修改"
    exit 0
  fi
fi

mkdir -p "$HOOKS_DIR"

for hook in pre-commit commit-msg; do
  src="$SCRIPT_DIR/$hook"
  dst="$HOOKS_DIR/$hook"
  if [ -f "$src" ]; then
    cp "$src" "$dst"
    chmod +x "$dst"
    echo "Installed $hook → $dst"
  else
    echo "Warning: $src not found, skipping"
  fi
done

echo "Done. Hooks installed in $HOOKS_DIR"
