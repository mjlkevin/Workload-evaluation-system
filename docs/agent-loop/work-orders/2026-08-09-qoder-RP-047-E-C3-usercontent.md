# Batch E 三次小修复工单 · 异步通道漏带用户问题（意图误判根因，C3）

- **缺陷来源**：ISS-2026-08-09-002 附带疑点 C3，Batch E 二次返工执行会话实锤确认（DB 中分类 reason 原文：「输入未包含用户查询文本」）
- **业务症状**：用户问「利润中心是什么」被误判为超范围不支持；异步通道（后台持久执行）的回答质量也同步受损
- **优先级**：P1（系统性影响每一轮异步对话的分类与回答质量）
- **预计工时**：2h（小单）

## 1. 根因（已实锤定位）

`apps/api/src/services/ai/handlers/workbench-shared.ts` 的 `buildWorkbenchChatModelChat` 工厂：

```ts
const safeMessages = messages.slice(-12).map(...);
if (safeMessages.length > 0) {
  safeMessages[safeMessages.length - 1] = { role: "user", content: userContent };
}
```

同步通道传入会话历史，最后一条用户消息被 `userContent` 覆盖，正常。异步通道（harness workflow）**不传 messages**，`safeMessages` 为空数组，`if` 被跳过——最终发给模型的 `messages` 只有 system prompt，`userContent`（用户问题）**从未进入请求**。意图分类器与回答模型都只看到系统提示词。

## 2. 修复方案（一行 else）

```ts
if (safeMessages.length > 0) {
  safeMessages[safeMessages.length - 1] = { role: "user", content: userContent };
} else {
  safeMessages.push({ role: "user", content: userContent });
}
```

## 3. 执行约定（Worktree Contract）

- **执行前置**：必须先读 `QODER.md` 与 `skills/wes-qoder-worktree-protocol/SKILL.md`，完成 Worktree Contract ACK；worktree 初始化后、编辑任何文件前，先执行 `npm install`（本单不涉及前端验证，无需 ui/V2_PROTOTYPE 二次安装）
- **worktree**：`.claude/worktrees/rp-047-e-c3-usercontent`
- **分支**：`qoder/rp-047-e-c3-usercontent`
- **base**：`8d0b757`（main，统一视图测试挂线恢复后）

## 4. Allowed Paths（只许改这些）

- `apps/api/src/services/ai/handlers/workbench-shared.ts`（唯一业务改动：else 分支）
- 既有测试文件（新增用例写进下列已存在文件，**禁止新建测试文件**）：
  - `apps/api/src/services/ai/workbench-intent.service.test.ts` 或 `apps/api/src/services/ai/workbench-dispatch.service.test.ts`（按归属就近）
- `docs/agent-loop/handoffs/2026-08-09-qoder-RP-047-E.md`（handoff 追加小修复节）

**forbidden**：不动 harness workflow、不动同步 handler、不动分类器提示词、不新增依赖、不改 package.json（本单不需要新挂测试入口）、前端零改动。

## 5. 验证矩阵（回填必须附每项实测输出）

| 套件 | 期望 |
|---|---|
| `npm run test:modules` | 316/316 |
| `npm run test:ai` | 256 + 新增用例数（附算式） |
| `npm run test:integration` | 1/1 |
| `npm run test:harness`（colima 环境变量） | 174 例，允许 T6/T7a 既有环境 flake（单文件重跑须过） |
| `npm run build:api` + `npm run build:web` | 零错误 |
| `git diff --stat 8d0b757 -- package-lock.json apps/api/drizzle/ ui/` | 零输出 |

**RED 先行**：新增用例断言「messages 为空数组时，modelChat 发出的请求包含 role=user 且 content=userContent」，先红后绿。

## 6. 硬纪律（上轮返工教训，违反即打回）

1. 新增测试一律写进 Allowed Paths 内**已存在的测试文件**，并确认该文件已在对应 npm script 清单内（不许动 package.json）
2. handoff 必须贴 `git log --oneline -4` 实际输出
3. 汇报中所有代号必须附业务主题注释（如「C3（异步通道漏带用户问题）」）
4. 全绿后先提交再回填；状态只能到「已回填 / 待主会话复审」，不得自宣已交付

## 7. 验收口径

异步通道发送「利润中心是什么」后，DB 中意图分类不再为 `unsupported_or_out_of_scope`（reason 不再出现「未包含用户查询文本」）；同步通道行为零变化（守护用例锁定）。
