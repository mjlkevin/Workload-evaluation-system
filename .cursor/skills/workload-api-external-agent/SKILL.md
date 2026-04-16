---
name: workload-api-external-agent
description: >-
  Configures external Agents (Kimiclaw / OpenClaw, HTTP toolchains, etc.) to call WorkEvolutionSys
  workload API over HTTPS. Covers base URL, health check, JWT login, Bearer usage,
  response envelope, Path A (chat → requirementSnapshot → kimi-assessment preview → markdown),
  Excel→Kimi 解析→Kimi 评估→Markdown 草稿导出（Agent 侧转 PDF）、 minimal curl.
  Use when integrating bots, MCP HTTP clients, or third-party automation with this repository's API
  or when the user mentions external Agent API setup, loca.lt tunnel, Kimiclaw demo, public API access,
  or conversational workload assessment.
---

# Workload API — 外部 Agent（Kimiclaw）配置与演示

## 运行事实（以代码为准）

- 唯一 HTTP 前缀：`{BASE}/api/v1`（`BASE` = 部署根，无尾部斜杠）。
- 鉴权：**JWT**，请求头 `Authorization: Bearer <token>`。不要使用 `X-Role` 作为权限依据。
- 成功响应形态：`{ "code": 0, "message": "ok", "data": ... , "requestId"?: string }`（**下载类接口见下条，可能非 JSON**）。
- 失败响应：`code` 非 0，常伴 `message`、`details`；HTTP 状态与业务码对应（401/403/400 等）。
- **未提供**专用 `/api/v1/agent/*` 路由；集成走现有业务接口（`auth`、`ai`、`templates`、`rule-sets`、`estimates` 等）。

## 最终交付物：PDF / Markdown / 文字 — 分别是什么、能否让用户选

| 形态 | 来自哪里 | 说明 |
|------|----------|------|
| **文字** | 始终可有 | `/ai/chat` 的 `data.answer` 即字符串；`/ai/kimi-assessment/preview` 返回 **JSON**，Agent 应用自然语言总结 `assessmentDraft`（模块人天、风险等）给用户。不另调导出接口也能交付「口头报告」。 |
| **Markdown 文件** | API | `POST /api/v1/ai/kimi-assessment/export-markdown` 的响应体为 **`text/markdown` 附件**（非 `{code,data}` JSON）。适合存档、版本管理、再编辑。 |
| **PDF** | 通常 **Agent 侧** | Kimi 评估链 **没有**与 `export-markdown` 对等的「服务端直接返回评估 PDF」接口；Skill 约定用 **pandoc / 打印为 PDF / Kimiclaw 文档转 PDF** 等把上一步的 **.md 转成 PDF**。另：`POST /api/v1/estimates/export/pdf` 属于 **模板规则估算**导出，与 Kimi 评估草稿 **不是同一条业务链**，勿混用。 |

**三种都可以吗？可以在 SKILL 里让用户选吗？**  
可以。**建议**在 Agent 配置或首轮询问中让用户选交付方式，例如：`text`（仅对话总结）、`md`（调用 export-markdown 并保存/下发文件）、`pdf`（export-markdown 得到 md 后再转 PDF 并下发）、`all`（文字摘要 + md + pdf）。API 侧无需区分；差异只在 Agent 是否调用 `export-markdown` 以及是否做 MD→PDF。

## 演示 1：连接系统并「记住」用户

**目标**：Kimiclaw 能稳定调用 API，不因每次对话丢失身份。

1. **持久化 JWT（推荐）**
   - 在 Agent 侧配置或密钥库保存：`WES_BASE`、`WES_USER`、`WES_PASS`。
   - 首次或 Token 失效时：`POST {BASE}/api/v1/auth/login`，JSON `{"username","password"}`，读取 `data.token`。
   - 后续所有需鉴权请求带：`Authorization: Bearer <token>`。
2. **探活与校验**
   - `GET {BASE}/api/v1/health`（可无 Token）。
   - `GET {BASE}/api/v1/auth/me`（需 Bearer）确认当前用户与角色。
3. **401 处理**
   - 若 HTTP 401 或业务 `details` 含 `invalid_or_expired_token`，重新执行登录并覆盖已存 Token。
4. **隧道**：`loca.lt` 等若插入浏览器验证页，非浏览器 Agent 会收到 HTML；需在隧道侧关闭验证或换可达公网入口。

## 路径 A：智能问询 + Kimi 快速评估人天（无 Excel）

**目标**：不经过 Excel 上传，用多轮对话收集需求要点，由 **Agent 侧组装** `requirementSnapshot`，再调用与需求页一致的 Kimi 评估接口；可选导出 Markdown。

**API 不会**把自然语言一步变成快照；**编排责任在 Agent / SKILL**（槽位追问 → JSON → `preview`）。

### 流程（顺序固定）

| 步 | 动作 | 方法 / 路径 | 说明 |
|----|------|-------------|------|
| 0 | 探活与登录 | `GET /api/v1/health`、`POST /api/v1/auth/login` | 同「演示 1」；`admin` 与 `sub_admin`/`user` 在 API 层均可能以 `operator` 身份调用 AI 路由（以 `auth/me` 为准）。 |
| 1 | 多轮智能问询 | `POST /api/v1/ai/chat` | Body：`{ "messages": [ { "role": "user" \| "assistant", "content": "..." } ] }`。服务端仅将**最近 12 条**发往 Kimi。成功：`data.answer`、`data.model`。 |
| 1b | （可选）企业画像 | `POST /api/v1/ai/company-profile-summary` | 仅有客户名等少量信息时，可 JSON 传 `customerName` 及已知 `location`/`customerIndustry` 等，补全 `enterpriseProfile` 等，再写入 `requirementSnapshot.basicInfo`。 |
| 2 | 组装快照 | （Agent 内存 / 工具） | 按下方「槽位与字段」把对话结论填入 `requirementSnapshot`，结构与「演示 2」步骤 B 相同。 |
| 3 | 快速人天（评估草稿） | `POST /api/v1/ai/kimi-assessment/preview` | Body 含 `requirementSnapshot`；解析 `code===0` 的 `data.assessmentDraft`（`moduleItems[].standardDays` / `suggestedDays` 等）。无 Kimi Key 时可能为 `rule_fallback`。 |
| 4 | （可选）下载草稿 | `POST /api/v1/ai/kimi-assessment/export-markdown` | 同「演示 2」步骤 C；响应为附件，非 JSON 包络。 |

### `/ai/chat` 约束（路径 A 必读）

- **必须**配置服务端 `KIMI_API_KEY`；未配置时接口报错（**无**规则兜底，与 `kimi-assessment/preview` 不同）。
- **无**流式 SSE；**无**服务端会话 ID——由 Agent 持久化 `messages` 数组。
- `role` 仅 `user` / `assistant` 有效（其它按 `user` 处理）；空 `messages` 会 400。

### 槽位 → `requirementSnapshot`（与 `apps/api/src/types` 对齐）

**`basicInfo`（对象）**：`customerName`、`location`、`projectName`、`opportunityNo`、`productLines`（数组）、`customerIndustry`（建议国标四级「编码+名称」链，与 Excel/Kimi 解析一致）、`enterpriseRevenue`、`itStatus`、`expectedGoLive`、`enterpriseProfile`、`projectBackgroundNeeds`、`projectGoals`。未知可填 `""` 或合理短占位，但评估质量依赖信息密度。

**行表**（缺则 `[]`）：

- `businessNeedRows`：`businessNeed`、`solutionSuggestion`、`requiresCustomDev`（如「是」/「否」）等。
- `productModuleRows`：**快速评估最关键**——`moduleName`、`subModule`、`userCount`、`productDomain`（可空）、组织相关列可 `"0"` / `""`。
- `devOverviewRows`：有则填 `codingDays`（编码人天）、`functionDesc` 等。
- `implementationScopeRows`：多组织、多地点时优先补。
- `valuePropositionRows`、`keyPointRows`：有则补，利于风险与假设。
- `meetingNotes`：字符串；无则 `""`。
- `devTotalDays`（可选）：若有 `devOverviewRows`，可对 `codingDays` 求和后 × **1.6** 保留一位小数；否则省略或 `0`。

**冷启动最小可用**：至少 `basicInfo.customerName` + `basicInfo.projectBackgroundNeeds`（把用户原述浓缩成一段）+ **一条以上** `productModuleRows` 或 `businessNeedRows`，否则 `preview` 易偏空或仅靠兜底规则。

### Agent 对话策略（建议写进 Kimiclaw 系统提示）

1. 用中文、短问句逐项补齐：客户与项目名、行业与规模、**实施产品/模块与用户规模**、是否二开/集成、组织与推广范围、已知开发人天（若有）。
2. 每轮可调用 `chat` 向用户解释或追问；**定稿快照前**在助手侧自检：是否已有模块+规模或等价业务需求描述。
3. 快照就绪后**再**调 `kimi-assessment/preview`，将返回的 `moduleItems` 用人话总结给用户；需要留档再调 `export-markdown`。

### curl 示例（chat → preview；`snapshot.json` 由 Agent 生成）

```bash
API="${BASE}/api/v1"
TOKEN=...  # login 获取

# 1) 多轮问询（单轮示例）
curl -sS -X POST "${API}/ai/chat" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"某制造企业上金蝶AI星空，财务云+供应链云，约300用户，两地两组织推广，暂无二次开发"}]}' \
  | tee chat.json

# 2) 评估（snapshot.json 为 Agent 根据对话组装的完整 body，含 requirementSnapshot）
curl -sS -X POST "${API}/ai/kimi-assessment/preview" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d @snapshot.json | tee preview.json
```

`snapshot.json` 最小形状与「演示 2」中「最小 JSON 骨架」一致；仅将 `requirementSnapshot` 从对话填充，勿省略 `requirementSnapshot` 键。

### 与路径 B（`/estimates/calculate`）的边界

路径 A 产出的是 **Kimi 实施评估草稿**（`assessmentDraft`）。模板规则引擎人天走 `POST /api/v1/estimates/calculate`，需 `templateItemId` 勾选，**不在**路径 A 内；若对用户承诺「标准模板人天」，需在 SKILL 中另开分支说明。

## 演示 2：上传需求 Excel → Kimi 解析 + Kimi 评估 → 草稿交付（Markdown / 转 PDF）

**业务链**（与需求页人工流程等价，全部由 API 完成）：

| 步骤 | 方法 | 路径 | 说明 |
|------|------|------|------|
| A | `POST` | `/api/v1/ai/parse-basic-info` | `multipart/form-data`，字段名 **`file`**，上传与需求页相同的 **Excel**。返回 JSON：`data.basicInfo`、`data.requirementImportData`（及 `model`/`mode` 等）。 |
| B | `POST` | `/api/v1/ai/kimi-assessment/preview` | JSON：`source`（可选 `globalVersionCode` / `requirementVersionCode`）、**`requirementSnapshot`**（见下文拼装规则）。返回 `data.assessmentDraft`、`data.meta` 等。 |
| C | `POST` | `/api/v1/ai/kimi-assessment/export-markdown` | JSON：`{ "assessmentDraft": <preview 返回的 draft>, "meta": <可选 preview.meta>, "projectName": "<可选>" }`。响应为 **`text/markdown` 附件**（非 `{code,data}` 包络）。Agent 可用 **pandoc / 打印为 PDF / Kimiclaw 内置文档转 PDF** 生成 PDF 并发送给用户。 |

**`requirementSnapshot` 拼装（与前端 `requirement-import` 提交评估时一致）**

从步骤 A 的返回中取：

- `basicInfo` → 直接作为 `requirementSnapshot.basicInfo`（对象）。
- `requirementImportData` 内各数组 → 对应快照字段（行对象可保留 `id` 等额外字段，后端可容忍）：
  - `valuePropositionRows`
  - `businessNeedRows`
  - `devOverviewRows`
  - `productModuleRows`
  - `implementationScopeRows`
  - `keyPointRows`
- `meetingNotes`：字符串，缺省用 `""`。
- `devTotalDays`（可选）：建议对 `devOverviewRows` 的 `codingDays` 求和后按前端习惯乘 **1.6** 再保留一位小数；若无开发行可传 `0` 或省略。

**最小 JSON 骨架（步骤 B body）**

```json
{
  "source": { "globalVersionCode": "", "requirementVersionCode": "" },
  "requirementSnapshot": {
    "basicInfo": {},
    "valuePropositionRows": [],
    "businessNeedRows": [],
    "devOverviewRows": [],
    "devTotalDays": 0,
    "productModuleRows": [],
    "implementationScopeRows": [],
    "meetingNotes": "",
    "keyPointRows": []
  }
}
```

将步骤 A 的 `basicInfo` / `requirementImportData` 各数组填入对应键即可。

**步骤 C：下载 Markdown（curl 保存文件）**

```bash
curl -sS -X POST "${API}/ai/kimi-assessment/export-markdown" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"assessmentDraft\":$(jq '.data.assessmentDraft' preview.json),\"meta\":$(jq '.data.meta' preview.json),\"projectName\":\"演示项目\"}" \
  -o "Kimi评估草稿.md"
```

（将 `preview.json` 换为步骤 B 保存的响应体；若 shell 拼装困难，可用 Kimiclaw 两步调用：先取 JSON 再组 body。）

**关于「发送 PDF」**

- 服务端当前提供 **Markdown 附件**，避免在无中文字体文件时 PDF 乱码；**由 Kimiclaw 将 `.md` 转为 PDF 再发送**即可满足演示。
- 若必须服务端直接出 PDF：需自行扩展（例如配置 `WES_KIMI_ASSESSMENT_PDF_FONT_TTF` 指向 `.ttf` 并用 pdfkit 注册字体），本 Skill 不依赖该变量。

## 首次配置清单（Agent 侧）

1. **设置 `BASE`**：公网或内网可访问的 API 根；本地 `http://localhost:3000`。
2. **探活**：`GET {BASE}/api/v1/health`。
3. **登录**：`POST {BASE}/api/v1/auth/login` → `data.token`。
4. **后续请求**：`Authorization: Bearer <token>`；`Content-Type: application/json`（**上传接口**为 `multipart/form-data`）。
5. **Token 过期**：401 时重新登录。

## 账号前提

- 注册需有效 **邀请码**（`POST /api/v1/auth/register`）。
- `parse-basic-info`、`kimi-assessment/*` 需 **admin 或 operator**（与路由 `requireRole` 一致）。

## 最小 curl 模板（复制后替换变量）

```bash
BASE="https://your-api-host"   # 改为实际部署根
API="${BASE}/api/v1"

curl -sS "${API}/health"

TOKEN=$(curl -sS -X POST "${API}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${WES_USER}\",\"password\":\"${WES_PASS}\"}" \
  | jq -r '.data.token')

curl -sS "${API}/auth/me" -H "Authorization: Bearer ${TOKEN}"
```

## 常用只读 / 业务入口（均需 Bearer，除非另有说明）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/health` | 无需 Token |
| POST | `/api/v1/auth/login` | 取 Token |
| GET | `/api/v1/auth/me` | 校验当前用户 |
| POST | `/api/v1/ai/chat` | 多轮问询（路径 A）；需服务端 Kimi Key |
| POST | `/api/v1/ai/company-profile-summary` | 可选：按客户名等补全企业画像 |
| POST | `/api/v1/ai/parse-basic-info` | Excel → Kimi（或规则）解析需求结构 |
| POST | `/api/v1/ai/kimi-assessment/preview` | Kimi 实施评估草稿（JSON） |
| POST | `/api/v1/ai/kimi-assessment/export-markdown` | 将草稿导出为 Markdown 附件 |
| GET | `/api/v1/templates` | 模板列表 |
| GET | `/api/v1/rule-sets/active` | 当前规则集 |
| POST | `/api/v1/estimates/calculate` | 工作量计算 |

更完整契约见仓库 `docs/openapi.yaml` 与 `03_技术设计/系统演进/实现与文档对齐说明.md`。

## 给 Agent 系统提示的摘要句（可粘贴）

在同一 `BASE` 下调用 `GET /api/v1/health` 确认服务；用 `POST /api/v1/auth/login` 获取 `data.token` 并持久化；所有需登录接口加 `Authorization: Bearer <token>`；JSON 接口只解析 `code===0` 的 `data`；401 时重新登录。**路径 A（无 Excel）**：维护 `messages` 多次调用 `POST /api/v1/ai/chat` 完成问询；Agent 将结论填入 `requirementSnapshot` 后调用 `POST …/kimi-assessment/preview`，可选 `POST …/export-markdown`。**路径（有 Excel）**：`multipart` 调 `parse-basic-info` → 拼装 `requirementSnapshot` → `preview` → 可选 `export-markdown`；Markdown 可由 Agent 转 PDF 发送用户。
