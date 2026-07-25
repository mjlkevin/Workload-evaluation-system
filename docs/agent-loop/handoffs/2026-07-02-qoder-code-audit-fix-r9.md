# WES Low-Risk AutoFix — R9 Handoff

## 目标
修复 CA-FE-005：SSE 流式响应时自动滚动失效。原依赖数组仅监听 `messages.length` 和 `sending`，SSE delta 事件只更新消息内容不改变数组长度，导致滚动不触发。

## Worktree
- **projectRoot**: /Users/kevin/AI/Workload-evaluation-system-agent
- **worktreePath**: /Users/kevin/AI/Workload-evaluation-system-agent/.worktrees/qoder-autofix-r9
- **branch**: qoder/code-audit-fix-20260702-r9
- **baseCommit**: 84611da
- **taskId**: CODE-AUDIT-FIX-20260702-R9

## 修复来源
- **auditReportPath**: docs/agent-loop/audits/2026-07-02-qoder-daily-code-audit.md
- **fixedFindingIds**: CA-FE-005
- **autoFixReason**: 依赖数组修正，添加最后一条消息内容长度作为额外依赖，不改变业务语义

## 变更文件
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`:
  - 添加 `lastMsgContentLen` 计算变量
  - 依赖数组 `[messages.length, sending]` → `[messages.length, sending, lastMsgContentLen]`

## 验证命令与结果
- `grep -n "CA-FE-005|lastMsgContentLen"`: pass（L1736-1742 确认）
- `npm run build:web`: pass（✓ built in 555ms，无错误）

## 风险
- **权限**: 无变更
- **数据**: 无变更
- **兼容**: 行为完全一致，仅在 SSE delta 更新时额外触发滚动
- **测试缺口**: 无自动化测试覆盖 SSE 滚动场景
- **人工验收缺口**: 需手动验证 SSE 流式响应时消息面板自动滚动到底部
- **scope risk**: 极低 — 添加一个派生依赖变量

## 是否建议看板同步
是，已同步 code-audit.html。

## 下一步建议
待 Codex 复核。
