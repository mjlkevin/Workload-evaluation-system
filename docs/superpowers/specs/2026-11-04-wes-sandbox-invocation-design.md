# WES 受控沙箱调用机制设计

日期：2026-11-04。状态：用户已于2026-11-04明确“开始实现”，按本稿进入实施；默认限制沿用本稿建议。

用户已确认：采用受控通用代码执行，由 LLM 根据任务编写代码；首期用 HTML、Word、Excel 验收。关联 ISS-2026-11-04-004 → RP-067；关联既有沙箱可行性问题 ISS-2026-08-27-004、Skill 机制 RP-050。RP-066 已被实施评估 SKU 控件需求占用。

## 1. 用户得到什么

用户在 AI 工作台说“把这些需求整理成 Word 和 Excel”，LLM 结合已选 Skill、会话和已授权材料，判断需要补充还是执行。执行时在中央消息流说明将处理哪些材料、生成什么；云端处理获确认后运行代码，展示进度，最后交付可下载的真实文件。问用途只介绍；选择 Skill、附加文件均不自动启动沙箱。

首期支持 Python / Node.js 代码任务，验收 `.html`、`.docx`、`.xlsx`；不承诺安装任意依赖、浏览器自动化、宏、任意外网访问或部署服务。纯自然语言总结继续直接由 LLM 回复。

## 2. 事实基线与方案选择

已实测：百炼模板/运行实例读取 200，Node `e2b@2.31.0` 连接既有实例成功，Python 3.13.13，合成文件写回一致，执行 1+1 返回 2。`jinja2` 已装，`python-docx` 和 `openpyxl` 未装。此证据不等于 WES 集成或文档验收完成。

本次用户提供的 Token Plan Key 访问 Sandbox 返回 401；以既有按量付费 Key 验证成功。控制台 `bailianSandboxId` 与 API 原生 `sandboxID` 不同，直接用前者读取曾返回 404。原模板构建 403 的失败调用身份仍未确认。

| 路线 | 适用性 | 本轮选择 |
| --- | --- | --- |
| WES 原生工具 + 受控执行服务 + 百炼适配器 | 保留 LLM 灵活编程，复用 WES 权限、Run、事件和产物归属 | 推荐 |
| 固定文档脚本接收结构化数据 | 输出稳定、实现较小，复杂排版和临时分析受限制 | 用户已选择更通用方向，作为工具的可选辅助库 |
| 直接暴露百炼/E2B/MCP 全套命令给 LLM | 快速原型，但模型可碰生命周期和底层连接信息，现有 Skill MCP 入口也有限制 | 首期不采用 |

## 3. 调用链与职责

```mermaid
flowchart LR
  U[用户消息与 Skill 上下文] --> M[LLM 理解任务并编写代码]
  M --> G[WES 权限与材料外发确认]
  G --> H[Harness 持久任务与事件]
  H --> S[Sandbox 执行服务]
  S --> A[百炼适配器与任务专属实例]
  A --> V[文件校验与 WES 产物保存]
  V --> F[中央消息流预览和下载]
```

- LLM：理解目标、选择能力、生成代码与预期文件清单，根据受控错误反馈修订代码；不决定权限和预算。
- 原生工具适配层：注册工具 Schema、能力位、外发属性和返回契约；调用统一任务服务，不持有云连接细节。
- Harness：复用 worker、租约、取消、事件、消息落库和恢复机制；执行状态不依赖浏览器或内存等待。
- Sandbox 执行服务：准备任务目录、核对材料归属、调度云操作、检查预算与有效授权、收集文件。
- 百炼适配器：封装 create/connect/run/files/release；存储两种实例 ID 的映射，供应商 SDK 和 token 不进入上层模型上下文。
- 产物仓储：保存文件字节和元数据、提供 owner 鉴权下载；沙箱目录不充当用户文件存储。

Web 仍为 `ui/V2_PROTOTYPE`，服务仍为 `apps/api`。建议把用例/持久状态放在 `modules/harness/sandbox/`，供应商传输放在 `services/sandbox/`；不新增 Python 业务后端。

## 4. 对模型开放的能力

首期只开放一个执行工具 `sandbox_execute`，一次可生成多个文件。创建实例、上传源材料、收集文件和释放实例由服务端完成，不逐个暴露成模型工具。

建议输入契约：

```json
{
  "title": "生成需求分析报告",
  "language": "python",
  "code": "由模型生成的脚本",
  "inputs": [{ "sourceId": "已授权材料引用", "name": "requirements.json" }],
  "outputs": [{ "path": "report.docx", "format": "docx", "title": "需求分析报告" }]
}
```

模型不提供 owner、云账号、实例 ID、凭据、命令解释器参数或外部下载 URL。`inputs` 只允许当前用户在本次任务内可访问的附件、既有执行结果或文件产物引用。代码源长度上限 128 KiB；输入和输出文件名只允许受限相对路径。

执行时服务器以固定入口 `python task.py` / `node task.mjs` 启动，语言决定命令，不拼接模型给出的 Shell 命令。LLM 的代码仍是不可信程序；固定入口和代码文本检查不能代替云隔离与网络限制。

工具完成结果仅包含 `jobId`、状态、脱敏摘要、退出码、产物 ID/名称/类型/大小和受限错误。调试详情中的 stdout/stderr 各最多 16 KiB，送回模型的文本合计不超过 8 KiB；日志不能成为新指令。

## 5. 普通对话、带 Skill 对话与正式执行

当前 `skills.conversation.ts` 的理解阶段明确 `tools: []`；当前 Skill 正式执行还拒绝外发工具，并要求工具参数等于冻结输入映射。`skills.context.ts` 的试运行执行器也拒绝外发、写入和 MCP。注册新工具本身不能消除这些限制。

首期采用独立的正式 `sandbox-task-v1` Harness 工作流：

1. 普通对话通过既有工作台工具循环选择 `sandbox_execute`；适配层将执行挂到持久 Run，外部结果等待可恢复，不让 HTTP 请求等待整个任务。
2. 带 Skill 的理解阶段继续只做结构化意图判断，新增受约束的计划类型：`skill`、`sandbox`、`skill_then_sandbox`。这是模型内部提议，服务端重新检查。对客户端保留既有 reply/clarify/execute 与 Run 引用口径。
3. `skill` 继续走原有冻结版本执行。`sandbox` 处理已明确要求的附件/已有结果。`skill_then_sandbox` 先完成原 Skill，再由 outbox 创建关联的文档 Run，输入引用已持久化的 Skill 结果。
4. 文档阶段使用独立 LLM 代码生成回合和 `sandbox-task-v1` 生产宿主；不改变已发布 Skill 的 input/output Schema，不给旧定义自动追加工具或权限。两段 Run 通过 interactionId 和 sourceRunId 关联，消息流显示同一请求的阶段。
5. 首期不支持在任意 Skill 内直接声明沙箱工具；以后如需此能力，单独扩展生产 adapter 和工具契约，不放宽试运行只读限制。

现有工具等待结果/恢复端口和会话计划输出需做明确适配，并不是已有能力已满足。文档失败时保留上游 Skill 结果，允许只重试文档阶段。

## 6. 确认、隔离与服务端权限

`sandbox_execute` 是云端处理，按现有 `exfiltrates=true` 的代码约束逐次确认。服务端产生批准摘要，绑定 run/callId、代码 hash、材料版本/hash、输出清单、供应商配置版本及预算；模型和客户端不能声明免确认。

待确认消息用业务语言说明材料、格式和时间上限，代码放折叠详情。用户一次可批准同一代码任务生成 HTML/Word/Excel 三个文件。修订代码或更换材料会形成新调用，原批准不能复用；首期不做会话级“以后都允许”豁免。改变这一点需要另行裁决现有外发策略。

文档文件写入与业务实体修改分开建模，但不能把外发工具伪装成本地只读安全工具。`sandboxReadSafe` 保持 false。沙箱不能直接创建项目、保存评估、修改用户权限；这些动作仍由 WES 原生业务工具独立确认。

每个生产任务使用一个专属实例，任务内可多次执行；任务完成或终止后回收。首期不跨用户、会话、任务复用实例，不把本次手工测试实例用于业务流量。后续用户要求修改文件时，从 WES 保存的原文件创建新任务。

沙箱仅有本次授权材料的副本，没有 WES JWT、数据库连接、模型 Key 或百炼 Key。不挂载业务库/共享磁盘；输入 hash 在 WES 冻结，沙箱内对副本的修改不影响原文。

生产模板与实例必须核验网络策略。用户于真实云验证后确认采用平台隔离：禁止公网，保留百炼自动加入的两个系统 OSS 内网通道（`*.oss-cn-hangzhou-internal.aliyuncs.com`、`*.oss-cn-beijing-internal.aliyuncs.com`），不声称完全断网。创建和重连读回校验 allowInternetAccess=false、allowPublicTraffic=false、IPv4/IPv6 deny-all；allowOut 仅接受上述固定通道的子集，出现额外出口或缺字段则拒绝执行。非系统内网和元数据服务未获授权开放。模板声明不能替代实例读回与实际访问验证。依赖、中文字体和辅助库预置在版本化模板中，运行时不执行 pip/npm 安装。若供应商不能兑现网络限制，则关闭通用代码能力，不能降级到宿主机执行。

## 7. 生命周期、预算与故障恢复

状态建议：planned → awaiting_approval → provisioning → staging → executing → collecting → validating → completed；异常为 failed/cancelled/unknown，资源回收另记 cleanup_pending/cleaned，不把文件成功与回收成功混为一项。

建议默认限制（本方案建议值，不是阿里云承诺）：单命令 120 秒、任务活动时间 300 秒、实例最长 900 秒；用户等待确认不消耗执行预算。每用户 1 个活动任务、平台 4 个活动任务，其余排队；每任务最多 3 次代码执行，修订代码逐次确认。最多 8 个输入文件、输入总量 20 MiB；最多 5 个产物，单个 20 MiB、总计 50 MiB。管理员可以收紧，模型不能调大。

实例创建前持久化 operationId、租约和配置 hash；创建后立即记录两种 ID。云创建响应丢失进入 provisioning_unknown：先核对可证明归属的云资源，不直接重新创建。无法确认时等待 TTL 回收/运维处理，不根据相近名称猜测归属。

命令派发前后记录 code hash、输入版本、PID/退出码与 attemptId。断线、worker 崩溃或命令超时后先检查原进程和已有输出；执行状态未知不自动重放任意代码。新尝试拥有独立输出目录，迟到结果通过租约/fence 检查后才能发布。

取消会阻止新命令与新产物发布，尝试终止已知进程、释放 WES 自建实例。回收失败写入持久补偿任务，重试并告警，由 TTL 兜底。只回收持有本地托管记录和匹配供应商元数据的实例，禁止清理用户手工实例。

## 8. 文件产物与消息流

产物先从沙箱取回暂存，检查实际路径、大小、格式、hash，再登记为可用。拒绝路径穿越、越界符号链接和非普通文件。返回码为 0 但缺失/无效文件不能标完成。

HTML 验收文档结构；在隔离预览容器中展示，默认禁止脚本、表单、外链请求和与主站同源能力。下载保留原文件，但不在 WES 主页面执行生成的 HTML。

DOCX/XLSX 校验 ZIP 包结构和必需条目、限制解压体积，拒绝宏、外部模板/工作簿关系及危险外联。XLSX 对不可信文本做公式注入防护；首期以脚本计算后写入结果值，不宣称具备 Excel 公式重算引擎。中文字体与示例渲染/打开验收包含在模板发布门禁。

文件字节首期经 ArtifactRepository 落 WES 私有文件目录，元数据入 Harness PostgreSQL；不把二进制或 token 塞进 JSON 业务结果。以后可替换对象存储，业务层不依赖路径布局。建议产物默认保留 30 天并显示到期时间；到期/用户删除先撤销下载，清理异步补偿；已过期产物不能成为后续输入。此为新产物保留策略，待本设计评审确认。

中央消息流展示理解、待确认、执行状态、错误和最终文件卡；右侧不恢复任务摘要。产物卡提供 HTML 隔离预览、文件下载，以及 Word/Excel 文件信息；首期不承诺在线编辑 Office 文件。刷新、切会话返回和沙箱释放后，仍能从 WES 读取有效产物。

## 9. 配置、持久记录与接口草案

管理员配置 provider、workspaceId、region、templateCode、SDK 固定版本、模板 revision/build 摘要、网络约束和配额；普通用户只使用能力。若模板无法固定不可变版本，部署时为每个发布创建独立 templateCode，并在运行前核对 build/revision，漂移则拒绝启动。

正式密钥用独立按量付费 Key，沿用现有 AES-GCM 凭据 DB 与审计，建议 scope=`sandbox:aliyun:<connectionId>`。本次临时使用的既有工具 Key 不自动写成生产配置。云连接 token 只在服务端内存使用；worker 恢复重新连接取得 token，不持久明文。

在 Harness 域内新增 sandbox jobs/calls 与二进制产物元数据，复用既有 Run、事件、租约和 outbox：记录 owner/session/run、托管实例标识、模板/代码/输入 hash、provider IDs、调用预算、执行状态和 artifactKey。按 `(runId, toolCallId, argsDigest)` 约束幂等；文件登记按稳定 artifactKey 防重复。不得用 JSON 配置文件管理高并发任务状态。

建议接口（尚未实现，实施时对齐 OpenAPI）：

- 管理员：`/api/v1/system/sandbox-connections` 配置与脱敏状态、单独测试连接、凭据写入/清除；测试模式不默认创建资源。
- 用户提交仍走工作台消息与 Harness Run；状态、确认、取消复用现有通道，不另建公开任意代码执行入口。
- `GET /api/v1/ai-artifacts/:artifactId/download`、`.../preview`：JWT + owner/session/run 关联校验；下载流不套 JSON，错误仍采用 WES `{code,message,data}`。HTML 预览隔离，不能使用可被脚本利用的长期 URL token。

## 10. 验收与实施拆分

| 批次 | 可验收结果 | 必须验证 |
| --- | --- | --- |
| A · 托管执行服务 | 生产配置、专属实例、执行与恢复、回收闭环 | Key 类型；ID 映射；权限撤销；出网阻断；创建/执行状态未知；租约过期；无用户实例误清理 |
| B · 产物服务 | HTML/DOCX/XLSX 真文件保存与鉴权下载 | 缺文件、错误格式、ZIP 炸弹、路径/符号链接、跨用户下载、HTML XSS/外联、到期和孤儿文件清理 |
| C · 工作台调用 | 普通消息及带 Skill 任务能生成并继续修改文件 | 问用途不执行；缺材料追问；外发逐次确认；拒绝/取消；Skill 完成但文档失败；刷新恢复；无右侧摘要 |

真实场景至少包括：自然语言生成三种格式；上传一份需求材料后输出 Word/Excel；对已有分析结果生成文件；新任务修改已有产物；沙箱释放后原文件仍下载；并发用户材料互不可见。分别留存真实模型、真实云调用、实际文件打开验证和失败证据，不能用本次 API smoke 代替这些验收。

本设计完成检查：现状已核实；用户已确认通用执行方向；已对比三种路线；本稿已检查占位、状态混淆、权限豁免与恢复歧义。整份方案及外发确认/实例隔离/保留期限尚待用户评审；评审后再编实施计划，本轮不实施。

依据：`skills.conversation.ts`、`skills.execution.ts`、`skills.context.ts`、`agent.types.ts`、`tool-registry.ts`、`workbench-tool-approval.ts`、`harness.types.ts`、`credentials.store.ts`；总看板 `events/2026-11-04-aliyun-sandbox-api-smoke.json`。

官方参考：[Sandbox API](https://help.aliyun.com/zh/model-studio/sandbox-api-overview)、[模板配置](https://help.aliyun.com/zh/model-studio/sandbox-api-template-create)、[代码解释器](https://help.aliyun.com/zh/model-studio/sandbox-best-practice-code-interpreter)。生产依赖/字体固化与产物回收方式参考官方建议；WES 权限、预算与存储选择是本稿建议，未宣称已实现。
