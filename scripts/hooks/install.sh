#!/bin/sh
# Install WES git hooks into the repository's hooks directory.
# Works for both regular repos and worktrees (hooks live in common .git dir).
# Usage: sh scripts/hooks/install.sh

HOOKS_DIR="$(git rev-parse --git-common-dir)/hooks"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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
