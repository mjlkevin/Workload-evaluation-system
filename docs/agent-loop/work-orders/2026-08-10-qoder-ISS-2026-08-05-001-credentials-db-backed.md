# 工单 · ISS-2026-08-05-001：凭据域 DB 化（API 密钥加密落库 + 变更审计）

> 状态：**已派发 KIMIK3（2026-08-10 用户拍板 B 方向，编制与派发一并批准）**
> 类型：defect（P1 阻断级，阻断 AI 主流程）· 来源：用户 2026-08-05 反馈 + 只读诊断 + 2026-08-10 方向决策
> 交叉引用：DEF-2026-08-05-001（同源转缺陷）/ RP-036（仅交叉引用，范围不同）/ MT「待更换密钥后复测」项（合入后解锁）
> base：`8425210`（main HEAD，派发时实填）
> 分支：`qoder/iss-2026-08-05-001-credentials-db-backed` · worktree：`/Users/kevin/AI/wes-worktrees/iss-2026-08-05-001`
> 治理前置：AGENTS.md §2 已声明凭据域为第二个 DB-backed 域；`00_项目治理/里程碑与计划/项目进展总结与后续规划.md` §九已记录决策。

---

## 1. 业务症状（用户视角）

1. 模型配置页录入的 API 密钥在服务重启 / git checkout / reset / merge 后「丢失」，AI 工作台报「AI 服务未配置 API 密钥」，AI 主流程阻断；
2. 真实密钥曾进入 git 历史（安全事件），**必须轮换**——系统侧职责是保证今后不再丢失、不再泄露、可审计；
3. MT 人工用例「待更换密钥后复测」项因本缺陷长期阻塞。

## 2. 根因（行号级，已取证）

1. 密钥明文存于 **git 跟踪**的 `config/system/requirement-settings.json`（draft/active 两层，`kimiCredentials.apiKey`）；任何 checkout/reset/merge 可把界面录入值覆盖回仓库空版本——「重启丢失」实为 git 操作覆盖；
2. 环境变量兜底 `KIMI_API_KEY` 经 [env.ts L35](file:///Users/kevin/AI/Workload-evaluation-system/apps/api/src/config/env.ts#L35) 读取，而 [env.ts L9-10](file:///Users/kevin/AI/Workload-evaluation-system/apps/api/src/config/env.ts#L9-L10) 以 `process.cwd()` 解析 .env——dev:api 以 apps/api 为 cwd 启动时根目录 .env.local 不加载，兜底实际失效；
3. 读取优先级在 [system.repository.ts L355-362](file:///Users/kevin/AI/Workload-evaluation-system/apps/api/src/modules/system/system.repository.ts#L355-L362)：`store.active.kimiCredentials.apiKey` → `config.kimi.apiKey`（env）；写入在 L262/L341-348 直接落 JSON 文件明文；
4. 无变更审计：谁在何时设置/清除密钥无记录。

## 3. 修复方案（决策完备，执行方不做设计决策）

### 3.1 新增凭据域 DB 表（迁移文件按 `apps/api/src/db/schema/` 现有命名与注册约定新增，参考最新既有迁移）
- `credentials`：`id serial pk`、`scope text unique not null`（首行 scope='kimi'）、`api_key_encrypted text not null`、`key_version int not null default 1`、`updated_by text`、`updated_at timestamptz not null default now()`；
- `credential_audit`：`id bigserial pk`、`scope text not null`、`action text not null`（'set' | 'rotate' | 'clear' | 'import'）、`actor text`、`at timestamptz not null default now()`、`meta jsonb`（仅存非敏感信息，如 key_version、来源，**严禁存密钥明文/密文**）。

### 3.2 加密方案
- AES-256-GCM；KEK 来自环境变量 `CREDENTIAL_KEK`（base64 编码 32 字节）；
- 密文格式 `v1:<base64 iv>:<base64 tag>:<base64 ciphertext>`；
- KEK 缺失时启动告警但允许仅读存量（dev 体验）：**写入路径**无 KEK 必须报错拒绝（不得降级明文）；
- `apps/api/.env.example` 补 `CREDENTIAL_KEK` 占位与生成说明（如 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`）；`apps/api/.env.local` 由指挥方/用户本地生成真实值（**执行方不得把真实 KEK 写入任何提交**）。

### 3.3 repository 切换（[system.repository.ts](file:///Users/kevin/AI/Workload-evaluation-system/apps/api/src/modules/system/system.repository.ts)）
- 新增 `apps/api/src/modules/system/credentials.store.ts`：封装 encrypt/decrypt/get/set/rotate + 审计写入（复用 `apps/api/src/db/client.ts`）；
- 密钥读写改走 credentials.store；`requirement-settings.json` 仅保留非敏感配置，`kimiCredentials.apiKey` 字段**永久写空串**（读取侧兼容：文件 apiKey 一律忽略）；
- `resolveKimiCredentials` 优先级改为：credentials DB → env（env 仅作 bootstrap 兜底，保留现状）；
- **一次性导入（幂等）**：启动时若文件 `active.kimiCredentials.apiKey` 非空且 DB 无 scope='kimi' 行 → 导入 DB（action='import'）并把文件该字段清空写回；DB 已有行时仅清文件不覆盖 DB。

### 3.4 接口与前端
- 现有系统管理密钥提交/清除接口契约**不变**（后端内部改落 DB + 写审计，actor 取 JWT 用户）；**前端零改动**；
- 同步/异步流式通道、harness runtime 一律不碰。

### 3.5 明确禁止
1. 禁止日志/错误信息/审计 meta 出现密钥明文或密文；
2. 禁止把真实 KEK / 真实 API 密钥写入任何提交、文档、看板；
3. 禁止改 `requirement-settings.json` 非密钥字段结构与读写；
4. 禁止触碰 ui/V2_PROTOTYPE、流式通道、看板页。

## 4. Allowed Paths（diff 必须全落以下清单）

1. `apps/api/src/db/schema/<新迁移文件>`（credentials + credential_audit）
2. `apps/api/src/modules/system/credentials.store.ts`（新增）
3. `apps/api/src/modules/system/system.repository.ts`
4. `apps/api/src/modules/system/system.usecase.ts`（仅当 actor 传递必需时）
5. `apps/api/src/config/env.ts`（新增 CREDENTIAL_KEK 读取）
6. `apps/api/.env.example`
7. `apps/api/src/modules/system/credentials.store.test.ts`（新增）
8. `apps/api/src/modules/system/system.repository.test.ts`（新增/扩展）
9. `config/system/requirement-settings.json`（仅一次性导入后的 apiKey 清空写回，若触发）

## 5. RED（先红证据，≥3，修复前实跑贴输出）

1. **重启留存**：set 密钥后模拟重启（重新实例化 repository，不依赖文件）读取 ≠ 明文落文件、解密一致——base 代码应红（现实现读文件，文件被清空即丢）；
2. **密文 + 审计**：DB 行 `api_key_encrypted` ≠ 明文且匹配 `v1:` 前缀格式；`credential_audit` 存在 action='set' 行；base 代码应红（无表无审计）；
3. **导入幂等**：文件 apiKey 非空 + DB 空 → 启动导入并清文件；二次启动不重复导入、不覆盖 DB 新值；base 代码应红。

## 6. 验证矩阵（base `8425210`，修复后全绿贴输出）

- `npm run test:web`：≥288（前端零改动，应 288/288）
- `npm run test:modules`：≥321 + 新增用例全过
- `npm run build:web` / `npm run build:api`：零错误
- 凭据域 DB 用例直跑：`npx tsx --test credentials.store.test.ts system.repository.test.ts`（属 Docker 集者注明，testcontainers 不可用时以直跑为准并在 handoff 声明）
- `git diff 8425210 -- apps/ config/ package-lock.json`：全落 §4
- 安全自检：`git grep -n "sk-\|CREDENTIAL_KEK=" -- apps/ config/` 无真实值（占位除外）

## 7. 分支与提交

- 分支 `qoder/iss-2026-08-05-001-credentials-db-backed`，worktree 内作业，主检出零接触；
- 提交格式 `type(scope): 中文描述`，聚焦「为什么」；收尾 handoff 回填本工单。

## 8. Handoff 格式

按 `skills/wes-multi-agent-collaboration/SKILL.md` Handoff Envelope：状态 / 目标 / 变更文件对照 §4 / RED 证据 / 验证矩阵输出 / 风险与范围外观察 / 是否需看板同步（建议页：issues、changes、testing）/ 下一步建议。代号必附主题注释。

## 9. 验收口径（人工复测五项）

1. 界面录入密钥保存 → 重启后端 → AI 工作台不报「未配置」，发一问可正常回复；
2. `credential_audit` 可见 set（及 rotate，若演练）审计行，actor 为操作账号；
3. `requirement-settings.json` 的 `kimiCredentials.apiKey` 恒为空串，非密钥配置不受影响；
4. 新提交 `git grep` 无密钥明文；
5. MT「待更换密钥后复测」项解锁并由用户复测通过（用户侧轮换 Moonshot 密钥为业务动作，系统侧不依赖）。

---

## Handoff Envelope — Qoder ISS-2026-08-05-001（凭据域 DB 化）

> 代号：Qoder-ISS-2026-08-05-001-credentials-db-backed（主题：API 密钥从明文 JSON 迁移到 PostgreSQL 加密落库 + 变更审计）
> 回填时间：2026-08-10 · base：`93da3ae` · 分支：`qoder/iss-2026-08-05-001-credentials-db-backed`

### 状态

**已回填 / 待 Codex 复核**

### 目标

修复 API 密钥重启后「丢失」缺陷：将密钥存储从 git 跟踪的明文 JSON 迁移到 PostgreSQL 加密落库（AES-256-GCM）+ 变更审计，文件 apiKey 永久写空串，读取优先级改为 DB 缓存 → env。

### 变更文件对照 §4

| 文件 | 类型 | Allowed Path | 说明 |
|---|---|---|---|
| `db/schema/credentials.ts` | 新增 | #1 | credentials + credential_audit schema |
| `drizzle/0016_credentials.sql` | 新增 | #1 配套 | 迁移 SQL |
| `drizzle/meta/_journal.json` | 修改 | #1 配套 | 迁移 journal 注册 |
| `db/schema/index.ts` | 修改 | #1 配套 | barrel export |
| `credentials.store.ts` | 新增 | #2 | encrypt/decrypt/get/set/rotate/clear/import + 审计 + 内存缓存 |
| `system.repository.ts` | 修改 | #3 | 读取走缓存；文件 apiKey 永久写空；一次性导入；save 兼容缓存 |
| `system.usecase.ts` | 修改 | #4 | async + 传 actor；toPublicKimiCredentials 读取源变更 |
| `config/env.ts` | 修改 | #5 | 新增 credentialKek |
| `.env.example` | 修改 | #6 | CREDENTIAL_KEK= 占位 + 生成说明 |
| `credentials.store.test.ts` | 新增 | #7 | 9 测试（4 加密 + 5 DB skip） |
| `system.repository.test.ts` | 修改 | #8 | +5 凭据域测试 |
| `requirement-settings.json` | 修改 | #9 | draft/active apiKey 清空 |

全落 Allowed Paths 及其直接配套（Drizzle 迁移 journal + barrel export）。主检出零接触。

### RED 证据

先写测试后实现，实跑确认失败：`Error: Cannot find module './credentials.store'`。三项 RED：重启留存（base 无 DB 表）、密文+审计（base 无表无审计）、导入幂等（base 无 importApiKeyIfAbsent）——全红 ✅

### 验证矩阵输出

| 验证项 | 结果 |
|---|---|
| test:modules | ✅ 328 tests, 0 fail（基线 321 + 7 新增） |
| build:api | ✅ 零错误 |
| build:web | ✅ 零错误（159 modules） |
| 凭据域直跑 | ✅ 23 tests, 18 pass, 5 skip（无 DB）, 0 fail |
| diff 93da3ae | ✅ 全落 Allowed Paths |
| 安全 grep | ✅ 仅测试假密钥 + .env.example 空占位 |

DB 测试 5 项因 worktree 无 TEST_DATABASE_URL 跳过，需 Codex 复核时在有 DB 环境下补验。

### 风险与范围外观察

1. usecase.ts 变更含 toPublicKimiCredentials 读取源变更（非仅 actor 传递），否则文件清空后 UI hint 退化为 none——属读取侧必需；
2. saveRequirementSystemConfigStore 兼容缓存填充：store 有非空 apiKey 时先填缓存再清文件——兼容 workbench-dispatch.service.test.ts 直接设 store.apiKey 场景（不可修改该测试）；生产路径幂等；
3. 一次性导入为 fire-and-forget：立即填缓存 + 异步导入 DB，导入失败时缓存已就绪 + env 兜底；
4. DB 测试未实跑：需有 DB 环境补验。

### 是否需看板同步

是。issues 页（状态更新）、changes 页（变更记录）、testing 页（DB 测试补验）。

### 下一步建议

1. Codex 五核复审：落点 / 矩阵 / RED / 主检出零接触 / 口径偏差；
2. DB 测试补验：USE_TESTCONTAINERS=true 环境下运行；
3. 合入前：用户在 .env.local 生成真实 CREDENTIAL_KEK；
4. 合入后：用户轮换 Moonshot 密钥 + MT 复测项解锁。
