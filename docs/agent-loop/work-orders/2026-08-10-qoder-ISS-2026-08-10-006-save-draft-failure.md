# 工单 · ISS-2026-08-10-006：系统管理 / 模型配置保存草稿失败修复

> 状态：**已派发 KIMIK3（2026-08-10）**
> 类型：defect（P1 高频级）· 来源：用户测试反馈
> 交叉引用：ISS-2026-08-05-001（凭据域 DB 化，已合入）/ ISS-2026-08-05-002（测试连接超时无反馈，已修复）
> base：`e84c727`（main HEAD，含凭据域 DB 化合入后状态）
> 分支：`qoder/iss-2026-08-10-006-save-draft-failure` · worktree：`/Users/kevin/AI/wes-worktrees/iss-2026-08-10-006`

---

## 1. 业务症状（4 个可观察事实）

1. **测试连接通过**：在模型配置页输入 API Key → 点击「测试连接」→ 显示「连接测试通过」（后端 `testRequirementKimiApiKey` 调用 `pingKimiChatCompletion` 验证连通性）
2. **保存草稿失败**：点击「保存草稿」→ 无成功提示或显式报错（静默失败）
3. **AI 工作台会话失败**：保存后切换到 AI 工作台 → 发起会话 → 报「AI 服务未配置 API 密钥」（后端 `resolveActiveRequirementKimiApiKey` 返回 `source: "none"`）
4. **API Key 消失**：回到模型配置页 →「更新密钥」输入框为空 →「当前密钥来源」显示「（未配置）」

## 2. 根因分析（三条假设链，按置信度排序）

### 根因 B（后端 KEK 缺失，置信度：高）

**现象 → 直接原因 → 根因链**：
- 现象：保存草稿时后端返回 50001「密钥存储失败」
- 直接原因：`updateRequirementSystemConfigDraft` L264-273 调用 `persistKimiApiKey` → `setApiKey` → `resolveKek()` 返回 null
- 根因：`apps/api/.env.local` 中 `CREDENTIAL_KEK` 未配置或配置后后端进程未重启加载

**代码证据**：
- `apps/api/src/modules/system/credentials.store.ts` L47-55：`resolveKek()` 读取 `process.env.CREDENTIAL_KEK || config.credentialKek`，缺失返回 null
- `apps/api/src/modules/system/credentials.store.ts` L140-143：KEK 缺失时抛 `Error("CREDENTIAL_KEK not configured: cannot write credentials")`
- `apps/api/src/modules/system/system.usecase.ts` L270-273：catch 后返回 `fail(res, 50001, "密钥存储失败", ...)`

**关键矛盾**：测试连接 `testRequirementKimiApiKey` 仅调用 `pingKimiChatCompletion` 验证连通性，不依赖 KEK；保存草稿 `updateRequirementSystemConfigDraft` 需 KEK 加密写入 DB。因此出现「测试通过但保存失败」。

### 根因 A（前端状态冲突，置信度：中）

**代码证据**：
- `ui/V2_PROTOTYPE/src/hooks/useSystemManagement.js` L258：`saveModelDraftWithKey` 与 L252 `saveModelDraft` 共享 action key `'saveModelDraft'`
- `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx` L180-181：`handleSaveModelDraft` 在 `await` 后立即 `setApiKeyInput('')`，不判断 result.success

**影响**：若后端返回错误，前端仍清空输入框，用户需重新输入密钥。

### 根因 C（状态假成功，置信度：低）

- `useSystemManagement.js` L259：若 `enabled=false`，`saveModelDraftWithKey` 提前 return undefined
- `withAction` L182-184：`data == null` 时返回 `{success: true}`，造成假成功

## 3. 修复方案（按优先级排序）

### 3.1 必修：后端 KEK 加载验证（P0）

**目标**：确保 `CREDENTIAL_KEK` 正确加载，保存草稿时加密写入 DB。

**实现**：
1. 在 `apps/api/src/modules/system/credentials.store.ts` `resolveKek()` 中增加 dev 环境友好提示：
   ```typescript
   export function resolveKek(): Buffer | null {
     const raw = process.env.CREDENTIAL_KEK || config.credentialKek;
     if (!raw) {
       // dev 环境：输出一次性警告到 stderr，不阻塞读取路径
       if (process.env.NODE_ENV !== "production") {
         console.warn("[credentials] CREDENTIAL_KEK not configured: credential writes will fail");
       }
       return null;
     }
     // ... 现有逻辑
   }
   ```
2. 在 `apps/api/src/main.ts` 启动时验证 KEK 配置状态（仅 warn，不阻塞启动）：
   ```typescript
   import { resolveKek } from "./modules/system/credentials.store";
   const kek = resolveKek();
   if (!kek) {
     console.warn("[startup] CREDENTIAL_KEK not configured: model config credential storage unavailable");
   }
   ```

### 3.2 必修：前端保存结果处理（P1）

**目标**：保存失败后不清空输入框，显示明确错误提示。

**实现**：
- `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx` L178-187：
  ```javascript
  const handleSaveModelDraft = async () => {
    setModelSaveResult(null)
    const result = await actions.saveModelDraftWithKey(apiKeyInput || undefined)
    if (result.success) {
      setApiKeyInput('')  // 仅成功时清空
      toast.success('模型配置草稿已保存')
    } else {
      toast.error(result.error || '模型配置草稿保存失败')
    }
  }
  ```

### 3.3 可选：action key 分离（P2）

- `useSystemManagement.js`：将 `saveModelDraftWithKey` 的 action key 改为 `'saveModelDraftWithKey'`，与 `saveModelDraft` 分离，避免 loading 状态冲突。

## 4. Allowed Paths（变更边界）

| # | 文件路径 | 操作 | 说明 |
|---|---------|------|------|
| 1 | `apps/api/src/modules/system/credentials.store.ts` | 修改 | `resolveKek()` 增加 dev 警告 |
| 2 | `apps/api/src/main.ts` | 修改 | 启动时 KEK 状态验证 |
| 3 | `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx` | 修改 | `handleSaveModelDraft` 结果处理 |
| 4 | `ui/V2_PROTOTYPE/src/hooks/useSystemManagement.js` | 修改 | action key 分离（可选） |
| 5 | `apps/api/src/modules/system/credentials.store.test.ts` | 新增/修改 | KEK 缺失场景测试 |

**禁止**：
- 禁止修改凭据域加密核心逻辑（`encryptCredential`/`decryptCredential`）
- 禁止修改 DB schema 或迁移文件
- 禁止引入新的 UI 组件或依赖

## 5. RED（测试驱动）

**RED 场景**：
1. KEK 未配置时 `resolveKek()` 返回 null 且输出警告
2. KEK 配置错误（非 base64 / 非 32 字节）时抛出格式错误
3. 前端 `handleSaveModelDraft` 在 result.success=false 时不清空输入框
4. `saveModelDraftWithKey` 与 `saveModelDraft` loading 状态独立

## 6. 验证矩阵

| 检查项 | 命令 | 通过标准 |
|-------|------|---------|
| TypeScript 构建 | `npm run build:api` | 零错误 |
| 模块测试 | `npm run test:modules` | ≥328（基线），零回归 |
| Web 测试 | `npm run test:web` | ≥296（基线），零回归 |
| 凭据域直跑 | `npx tsx --test apps/api/src/modules/system/credentials.store.test.ts` | 全绿 |
| diff 边界 | `git diff e84c727 --stat` | 全落 §4 Allowed Paths |
| 安全 grep | `git grep -n "sk-\|CREDENTIAL_KEK="` | 无真实密钥/KEK 值 |

## 7. 分支与工作树

```bash
cd /Users/kevin/AI/Workload-evaluation-system
git worktree add /Users/kevin/AI/wes-worktrees/iss-2026-08-10-006 e84c727
cd /Users/kevin/AI/wes-worktrees/iss-2026-08-10-006
git checkout -b qoder/iss-2026-08-10-006-save-draft-failure
```

## 8. Handoff 回填要求

执行方完成修复后，按以下格式回填：

```
状态：已回填 / 待 Codex 复核
变更文件：<表格：文件/操作/说明>
验证命令与结果：<逐项输出>
风险：<界内偏差说明>
分支信息：<分支名 / commit / worktree / base>
```

## 9. 验收口径

修复完成后，用户按以下步骤验证：
1. 浏览器刷新 localhost:3002
2. 进入「系统管理 → 模型配置」
3. 输入 API Key → 点击「测试连接」→ 确认通过
4. 点击「保存草稿」→ 确认显示「模型配置草稿已保存」成功提示
5. 切换到 AI 工作台 → 发起会话 → 确认正常回复（非「未配置 API 密钥」）
6. 回到模型配置页 → 确认「当前密钥来源」显示「已配置 ·····xxx」
7. 刷新浏览器 → 确认密钥来源仍为「已配置」

---
*工单编制：Codex（全局指挥）*
*base：e84c727*
*派发时间：2026-08-10*
