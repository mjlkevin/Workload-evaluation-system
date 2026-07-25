# WES Low-Risk AutoFix — R10 Handoff

## 目标
修复 CA-FE-004：API client 未处理非 JSON 响应。`res.json()` 无 try/catch，当服务器返回 HTML 错误页或纯文本时会抛出未捕获异常。

## Worktree
- **projectRoot**: /Users/kevin/AI/Workload-evaluation-system-agent
- **worktreePath**: /Users/kevin/AI/Workload-evaluation-system-agent/.worktrees/qoder-autofix-r10
- **branch**: qoder/code-audit-fix-20260702-r10
- **baseCommit**: 84611da
- **taskId**: CODE-AUDIT-FIX-20260702-R10

## 修复来源
- **auditReportPath**: docs/agent-loop/audits/2026-07-02-qoder-daily-code-audit.md
- **fixedFindingIds**: CA-FE-004
- **autoFixReason**: 防御性包裹，不改变业务语义，仅增强错误处理

## 变更文件
- `ui/V2_PROTOTYPE/src/api/client.js`:
  - `return res.json()` → try/catch 包裹，解析失败抛出 `ApiError(res.status, 'INVALID_RESPONSE', ...)`

## 验证命令与结果
- `grep -n "CA-FE-004|INVALID_RESPONSE"`: pass（L58-63 确认）
- `npm run build:web`: pass（✓ built in 561ms，无错误）

## 风险
- **权限**: 无变更
- **数据**: 无变更
- **兼容**: 行为完全一致，仅在非 JSON 响应时抛出类型化错误而非原生 SyntaxError
- **测试缺口**: 无自动化测试覆盖 API client 错误处理
- **人工验收缺口**: 需手动验证服务器返回非 JSON 时的错误提示
- **scope risk**: 极低 — 单函数防御性包裹

## 是否建议看板同步
是，已同步 code-audit.html。

## 下一步建议
待 Codex 复核。
