# WES 受控沙箱与文件交付实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 用户已于2026-11-04明确“开始实现”；沿用现有隔离分支codex/wes-skills-c，不推送、不合入主线，不触碰既有model-verify-status改动。

**Goal:** LLM按任务生成Python/Node代码，经逐次确认在百炼专属实例执行，并在中央消息流交付经鉴权的HTML/DOCX/XLSX文件。

**Architecture:** WES原生工具声明外发，正式Harness运行承载持久确认及恢复；独立Sandbox任务仓储防止未知云操作重放。供应商适配器只处理云调用，文件仓储验证并保存字节；Skill试运行与已发布定义保持现有权限约束。

**Tech Stack:** Express/TypeScript、现有Harness PostgreSQL与AES-GCM凭据、e2b固定2.31.0、React/Tailwind tokens；ZIP检查复用已有jszip，新增文件不引入第二执行后端。

## 验证基线与约束

- 基线cbd3159（设计提交）；保护config/system/model-verify-status.json。
- 本次仅实现RP-067，不自动处理需求池下一项；不建立Codex Loop。
- 云操作只作用于WES创建并登记的资源，不释放用户手工测试实例。
- 真实验收需正式连接配置与出网阻断证明；缺少配置时明确禁用，不用模拟通过替代云验收。
- 调整代码/材料/配置后旧确认失效；缺少持久Run与批准证明时不得执行。
- 来源是owner授权的不可变材料/产物；文件名受限，禁止用户或模型提供外部下载地址。

## Task A1：供应商与文件边界

Files: services/sandbox/sandbox-provider.ts、bailian-provider.ts；modules/harness/sandbox/sandbox-artifacts.ts及对应node:test文件；apps/api/package.json与锁文件（只增加e2b固定版本）。

- [x] RED：provider HTTP/SDK边界测试，错误不泄露凭据；模板版本/网络漂移拒绝；TTL900秒，固定入口、绝对受控任务目录，禁止任意shell参数。
- [x] RED：文件路径穿越/符号链接/ZIP外链与宏/解压炸弹/缺失必需条目/体积上限/owner与过期读取失败；HTML隔离预览的响应头。
- [x] GREEN：provider封装create/connect/files/run/release。只有云端执行代码，SDK在服务端，错误映射成固定消息；readOutput先检查regular file与受限大小，读取二进制。
- [x] GREEN：ArtifactRepository本地私有字节存储，随机键、原子写、SHA256；验证后才能登记。DOCX/XLSX禁止外部relationships、宏和危险嵌入；HTML下载attachment，预览CSP拒绝脚本/网络/表单。
- [x] 定向命令：cd apps/api && node --import tsx --test src/services/sandbox/*.test.ts src/modules/harness/sandbox/sandbox-artifacts.test.ts。
- [x] 规格复核后质量复核；分批提交，不包含运行配置。

接口约定：SandboxConnection含id/workspaceId/region/templateCode/templateRevision/aliyunUid/enabled；provider实例由连接配置与apiKey构造，暴露verifyTemplate()/create(jobId,ttlSeconds)/connect(sandboxId)。返回SandboxInstance含id/writeFile(relativePath,bytes)/execute(language,code,timeoutMs,signal?)/readOutput(relativePath,maxBytes)/release()；execute返回exitCode/stdout/stderr。禁止接口自动扩展成宿主shell工具。

## Task A2：持久任务、配置与安全执行

Files: modules/harness/sandbox/sandbox.types.ts、sandbox.repository.ts、sandbox.service.ts、sandbox.module.ts、sandbox.controller.ts；db/schema/harness-sandbox.ts、schema/index.ts、drizzle工具生成迁移；routes/sandbox.routes.ts、routes/index.ts。

- [x] RED：并发用户隔离；同Run+调用幂等；已获确认但材料版本/配置变化拒绝；缺审批/同步通道拒绝；创建响应未知不重新create；执行响应未知不重新run；释放失败保留补偿状态。
- [x] GREEN：连接配置与job/artifact元数据置于Harness域；密钥调用credentials.store既有加密接口。迁移必须db:generate并生成快照。
- [x] GREEN：job先冻结代码/材料hash/配置，再确认；领取执行权需原子条件更新与有效Run。执行中核对取消，超时释放；原实例ID已知时重启仅回收/核对，不自动重放代码。
- [x] GREEN：每用户1任务、全局4任务；活动300秒、命令120秒、TTL900秒；8个输入20MiB；5个输出单20MiB/总50MiB；产物30天到期失效。
- [x] GREEN：创建、执行、收集、校验、清理分别持久化；late结果不得发布。挂起等待不消耗活动预算。实例回收补偿仅针对托管记录。
- [x] 接口：admin GET/PUT sandbox-connections与只读连接检查；JWT owner GET artifact download/preview。错误WES envelope；二进制成功流不封JSON。配置Key不回显。
- [x] 测试：独立repository真实PG事务用例清理仅自有ID，不TRUNCATE共享表；模块回归与API构建。

## Task C1：正式工作台调用与Skill上下文

Files: agent/tools/sandbox.tools.ts、agent/default-registry.ts；services/ai/workbench-tool-loop.ts、workbench-tool-approval.ts；modules/harness/workbench-chat.workflow.ts、harness-boot.ts；modules/skills/skills.conversation.ts及相关受控生产路由。

- [x] RED：sandbox_execute为exfiltrates=true、sandboxReadSafe=false；无审批/无Run时失败；每次调用独立确认；批准摘要绑定服务端冻结计划。
- [x] GREEN：工具仅供正式宿主使用，准备计划与批准后执行分离。把run/attempt/session/取消信号从真实worker一路透传；不得通过模型参数提供身份。
- [x] GREEN：普通消息由模型决定是否调用。带Skill理解阶段保持tools为空，允许计划skill/sandbox/skill_then_sandbox；执行后文件任务与原Skill结果引用关联，不改发布Schema和试运行只读规则。
- [x] RED/GREEN：持久恢复不重复创建实例/执行代码，刷新可恢复确认和文件；文档失败保留上游Skill结果。
- [x] 定向：工具循环、审批、Skill conversation、Harness生产宿主测试；npm run test:modules、test:agent、test:harness。

## Task C2：中央消息流产物

Files: ui/V2_PROTOTYPE/src/api/下文件访问层、pages/AiHomeWorkbench/components/ChatArea/下SandboxArtifact卡与单测，既有工具结果卡接入。

- [x] UI前置npx ui-skills start；仅AI工作台一个业务表面，三个实现目标：明确外发确认、文件卡下载、隔离HTML预览。
- [x] RED：卡片从真实tool result提取文件引用；带Bearer fetch Blob下载，不把token放URL；过期和下载失败可读反馈；iframe sandbox无allow-scripts/allow-same-origin。
- [x] GREEN：用户可从消息流完成确认/取消/下载，右侧不恢复摘要。代码在折叠详情；不宣称文件生成直到服务端产物登记成功。
- [x] 测试：定向React测试、Web完整回归、双构建；1440/760浏览器实际路径留证。

## Task D：文档、安全与真实验收

- [x] OpenAPI/README/实现对齐文档同步；记录配置、依赖和部署迁移步骤。
- [x] npm audit和定向安全检查：凭据、外部URL、代码入口、owner/过期、HTML/ZIP、恢复/取消/资源归属。
- [ ] 真实模型+真实云场景：问用途不执行；生成HTML/Word/Excel；附件整理；既有结果导出；修改原产物；拒绝/取消；跨用户不可见；释放后下载。
- [x] 对未具备的环境条件如实留缺口，不修改业务数据、凭据或旧测试预算凑通过。
- [x] 更新RP-067及Issue/设计/运行/计划/测试/监控/风险/变更/资料与首页；board-build和consistency为21页0错0警。

## 交付口径

实现、自动化检查、真实云与模型验证、用户验收分别登记。只提交任务自有文件；保护其他dirty改动；本地候选不代表主线发布。

执行回填：模块1235/Harness697/Agent259/AI286/Web1001及双构建通过；真实模型技术文件链路和浏览器下载通过。早期内容失败与Office阅读差异保留，最终明确提示的合成内容检查通过，生产Key、扩展真实场景和用户验收待完成。详见实现与验证记录。
