#!/usr/bin/env bash
# macOS：为开发用的 Node 进程允许「传入连接」，使局域网可访问本机 3000/3001（由 npm run dev:api / dev:web 监听）。
# 说明：系统防火墙按「应用」放行，不能单独只开两个端口；放行 Node 后，所有由该 node 二进制监听的端口均可被访问。
#
# 使用：在项目根目录执行
#   chmod +x scripts/macos-firewall-allow-node-dev.sh
#   sudo ./scripts/macos-firewall-allow-node-dev.sh
#
# 若使用 nvm / fnm，请先在本终端能 `which node` 到实际路径后再 sudo（或把下面 NODE 改成你的绝对路径）。

set -euo pipefail

SFW="/usr/libexec/ApplicationFirewall/socketfilterfw"
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "未找到 node，请先安装 Node 或把 PATH 配好后再运行本脚本。"
  exit 1
fi

# 解析真实路径（避免符号链接）
if [[ -L "$NODE" ]]; then
  NODE="$(readlink "$NODE" || true)"
fi
if [[ ! -x "$NODE" ]]; then
  NODE="$(node -p 'process.execPath')"
fi

echo "Node 路径: $NODE"
echo "当前防火墙状态:"
"$SFW" --getglobalstate || true
echo ""

if [[ "${1:-}" == "--check-only" ]]; then
  exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 sudo 运行: sudo $0"
  exit 1
fi

"$SFW" --add "$NODE" 2>/dev/null || true
"$SFW" --unblockapp "$NODE"

echo "已为 Node 允许传入连接。若仍无法从局域网访问，请检查："
echo "  1) 系统设置 → 网络 → 防火墙 → 已打开时，选项里 Node 应为「允许传入连接」"
echo "  2) 前端已使用 -H 0.0.0.0（本仓库 dev:web 已配置）"
echo "  3) 路由器/公司网络是否隔离客户端（AP 隔离）"
