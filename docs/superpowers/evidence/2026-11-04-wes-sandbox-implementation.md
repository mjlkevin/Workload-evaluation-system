# WES 受控沙箱实现与验证记录

日期：2026-11-04。关联 ISS-2026-11-04-004 / RP-067。状态：本地候选实现与自动检查完成；真实模型技术链路与本次合成样本内容检查通过，扩展场景与人工验收待完成。未合主线、未推送、未生产启用。

## 已实现

原生 sandbox_execute、服务端冻结代码/材料hash/连接身份、逐次持久审批、独立任务实例、预算、取消/租约校验、未知执行不盲目重放、代码修订需新确认。模型决策仅在沙箱流程冻结；普通聊天原写工具与追问恢复规则保留。Skill理解仍无工具，选标签不执行；可直接生成文件或分析后关联文件Run。

HTML标准解析与OOXML包/命名空间/关系/文本节点校验、私有文件、owner/会话/到期校验、Bearer Blob下载、隔离HTML iframe接入中央消息流。维护器轮转回收失败、游标清理过期文件；过期立即拒读。依赖e2b固定2.31.0、parse5固定7.3.0；PG迁移0031/0032。实现提交按供应商、持久服务、宿主、维护、文件卡、修订分批保留。

## 用户决定与云端边界

用户授权临时使用既有Qoderwork Key做合成测试，不保存为生产凭据；确认“按平台隔离交付”：公网受平台策略阻断，只保留两个固定系统OSS内网通道，不宣称air-gap。原WES-docs-test及手工实例未修改。验收新建WES-docs-controlled-20261104，code=f902c2af-a5bf-49c9-829d-bc704b8c798d，ready build=36d6e887-df67-4a8f-af5e-5cbc209a03ad。

模板要求空环境/挂载与拒绝全部IPv4/IPv6；实例创建和重连读回只接受两个固定OSS内网域。完整HTTPS固定公网目标未取得响应，TCP握手曾可建立，故不能把此证据提升为所有协议完全断网。真实适配器uid1000、环境仅PATH/HOME/LANG；stdout/stderr洪泛各限16KiB，超时124。WES创建的实例均释放，用户手工实例未纳入回收。

## 自动化与构建

| 实跑范围 | 结果 | 证据 |
|---|---|---|
| test:modules原文件列表，显式串行，隔离 *_test 库 | 1235/1235，0失败/跳过 | /tmp/wes-sandbox-modules-delivery.log |
| test:harness，独占workload_eval_test | 697/697，0失败/跳过 | /tmp/wes-sandbox-harness-exclusive-final/test:harness.log |
| test:agent | 259/259，0失败/跳过 | /tmp/wes-sandbox-agent-ai-delivery.log |
| test:ai | 286/286，0失败/跳过 | 同上 |
| test:web完整 | 1001/1001 | /tmp/wes-sandbox-web-latest.log |
| UI独立复核 | 43/43，含Bearer helper探针 | 文件卡、原审批与可见性回归 |
| build:api / build:web | 通过 | /tmp/wes-sandbox-build-api-final.log、/tmp/wes-sandbox-build-web-delivery.log |
| Office文本嵌套定向回归 | RED缺少拒绝→GREEN 18/18 | /tmp/wes-sandbox-office-leaf-{red,green}.log |

Harness全量在最后的文本叶节点加严前完成；加严后模块1235、文件定向18及API构建复验。前端之后未改代码。定向复核还包含SSE/模型缓存/实际网络读回44、服务14、维护器8、旧审批与沙箱宿主21项通过，不能与全量相加冒充独立用例数。

默认并行模块曾出现两例30ms取消/超时竞态；不同套件共库也曾干扰。失败日志保留，最终按原文件列表串行且套件隔离重跑，未改变旧预算和断言。Skill仓储测试改为与全局相同 *_test 后缀守卫；执行域严格workload_eval_test守卫未放宽。

旧集成脚本仍失败templates_status_not_200，属既有活动模板环境缺口；没有创建或修改业务模板凑通过。npm audit为45项（critical1/high11/moderate33），没有清零；e2b依赖链含glob moderate，parse5无新增报告。定向安全复核不等于全仓依赖审计通过。

## 真实模型、云与文件

使用实际qwen-plus（复用Kimi/OpenAI兼容传输）、真实Harness队列/worker/审批/PG仓储、真实百炼适配器与JWT文件路由；只将连接与临时Key在进程内注入，没有保存连接或凭据。技术闭环记录见[真实模型元信息](2026-11-04-wes-sandbox/real-model-technical-pass.json)，适配器合成记录见[供应商元信息](2026-11-04-wes-sandbox/provider-synthetic.json)。

早期技术样本：问用途completed且0实例；文件任务确认前waiting且0实例；确认后completed，创建1/释放1，3次模型请求，三类真实文件落盘。每个文件owner下载200且SHA256匹配、跨用户404、匿名401；实例释放后下载仍成功。该样本技术成功不能证明内容忠实：模型额外添加了供应商/物料等字段。

后续质量复测发现Word嵌套w:t在部分阅读器漏正文、Excel遗漏导出需求；[失败元信息](2026-11-04-wes-sandbox/real-model-content-quality-failure.json)保留。服务端已对文本节点加严，不会自动修改模型产物来隐藏错误。随后使用明确的“只整理原始两项、不得新增字段”提示复测；这不能证明模型对任意业务输入均忠实。

初次真实模型还暴露SSE逐片段trim破坏Python缩进，已修复且5例RED→GREEN（provider32/32）。另有只返回BytesIO未写独立文件、模型60秒超时记录；文件工具现返回可修订错误并要求新确认。失败日志和原文件保留于本机/tmp，不作为通过证据。

最终修订闭环见[真实模型修订元信息](2026-11-04-wes-sandbox/real-model-repair-pass.json)：同一Run a382636c-c6bc-4a23-a507-637b866eb891 内首次只返回内存内容、第二次包结构非法，均被拒绝；LLM分别修订并各重新确认，第三次通过，累计创建3/释放3、5次模型请求。没有修改冻结代码或自动复用旧批准。确认由合成测试用户程序化执行，不能称为人工确认验收。

最终文件 [HTML](2026-11-04-wes-sandbox/report.html)、[Word](2026-11-04-wes-sandbox/report.docx)、[Excel](2026-11-04-wes-sandbox/report.xlsx)均可从真实JWT路由取得，哈希一致；实际解析三种内容均保留仓库管理员、日期查询、导出两项，未出现此前额外字段，见[内容检查](2026-11-04-wes-sandbox/real-model-content-check.json)。此结果仅覆盖本次合成输入。

## 浏览器与Office检查

Ego Lite访问合成验收UI3009，最终修订文件也完成下载/预览复验：消息流三文件卡、刷新保留、隔离HTML预览内容、真实Word下载哈希与服务端一致；1440/760宽文档未横向溢出。iframe sandbox为空，不授予脚本/同源权限，使用Blob而非携JWT地址。截图见[1440](2026-11-04-wes-sandbox/workbench-1440.png)、[760](2026-11-04-wes-sandbox/workbench-760.png)和[三文件卡](2026-11-04-wes-sandbox/workbench-1440-cards.png)。

最终样本可由python-docx/openpyxl读入，两项原文均在。Mac QuickLook能显示中文，最终截图见[Word](2026-11-04-wes-sandbox/word-quicklook.png)、[Excel](2026-11-04-wes-sandbox/excel-quicklook.png)，不提升为跨阅读器编辑兼容性结论。捆绑LibreOffice渲染曾中文空白，不把QuickLook可见提升为Office全面通过。

## 尚未验收

生产独立Key和正式连接、真实客户业务内容、附件整理、现有Skill结果导出、修改原产物、人工Word/Excel完整编辑与显示仍待逐项验收。拒绝/取消/租约/过期等有自动化证明，未全部做真实云人工场景。合成验收3009的后台worker只在验证进程启用；页面不是生产服务。

预览3006/API3004已重载候选代码，健康200、连接表0行（生产未配置）。部署/恢复见[运行说明](../specs/2026-11-04-wes-sandbox-operations.md)。总看板同步需求、Issue、设计/架构、运行、计划、测试、监控、风险、变更、资料与首页；RP-067保留实施中，用户验收不冒充完成。

看板构建与一致性：候选及主目录均21页/0错误/0警告；候选资料102行/101去重引用，主目录105行/104引用。新增资料行已实际浏览，[截图](2026-11-04-wes-sandbox/board-source-row.png)保留存量窄分类列换行现状，未改共享样式；RP-067保持单行。

## 追加：原用户会话3378的Kimi HTML验收

用户授权修复两个参数、配置独立Key并继续原会话。提交9df45d7为language/format的enum补type:string；出站Kimi请求体RED缺失类型→GREEN定向43，模块原列表显式串行1236/1236、0跳过，API构建通过，未改测试预算。

独立WES-sandbox-acceptance-20261104 Key（服务侧ID8524328）经用户明确同意创建，只加密保存到本地验收库scope sandbox:aliyun:default，v1密文、keyVersion1；连接/固定模板检查200。本轮未保存Qoderwork Key，未推送或启用其他生产环境。

同会话33782966-44d4-476f-b38e-6af1a96856cc：原失败Run e5cb8cb6-12c2-45ee-90d8-5adda4814787保留；原样重试f0e8d887-7a73-4546-ac90-eaecedd8aae5越过400后在既有120秒模型上限超时，无实例。随后追加简洁HTML指令；理解阶段未读到业务结构化结果并追问，测试从原最终输出完整复制JSON补入提示，不重新模拟或拆解。

新Run c3c351df-ce67-4b26-80fa-53ebfb22be84为sandbox-task-v1，实际模型kimi-k3。第一次虚构来源ID被权限层拒绝，模型改为内嵌原JSON；AST只含json/html与本目录写入，字面量与原结果完整相等。Codex按用户授权在真实界面点同意后，冻结脚本运行退出0，1个云实例已释放，Run completed。该操作是自动化代验，不替代用户人工验收。

[HTML报告](2026-11-04-wes-sandbox/3378-report.html)为5739字节，SHA256 caf05024670650bbfa8e485b37cd514a9ae4cb9c54c44cdabf412a0bcaf853bc；JWT路由200及真实浏览器下载哈希相同。解析后逐字段核对七条需求的编号、标题、描述、原文和30个问题全部存在。隔离Blob iframe实际显示REQ-001标题，见[结果截图](2026-11-04-wes-sandbox/3378-result.png)、[批准卡](2026-11-04-wes-sandbox/3378-approval.png)与[内容检查](2026-11-04-wes-sandbox/3378-content-check.json)。原七条输出未改，失败历史未删。

边界：成功来自同一会话新增的简洁指令和完整JSON材料，不把原长提示的超时改称成功；后续理解未自动带业务结果的缺口仍保留。未改前端、未改已发布Skill定义、未放宽确认/来源或网络边界。主线仅同步治理记录，代码仍在隔离候选。


## 2026-11-04 · 用户同意本版本地合并

用户“这一版可以提交合并了”后，候选ac0a078合入本地main，合并提交bb208c16237d0bd3492d2630ddc62c74647aeaa4；没有推送。原主目录25个已修改文件、120个未跟踪文件已完整备份；原SKU源码和图标逐字节保留为独立未提交工作，不混进本版提交。合并提交的回归结论不覆盖该独立WIP组合。验收预览及候选工作树保留，原运行配置不提交。

验证：本轮模块1236/1236、此前完整Harness697/697、Agent260/260、AI286/286、Web1001/1001，均无失败或跳过。此次Harness长回归因同目录另一批未提交公网策略修改而中止，不作为通过证据；固定ac0a078在干净验证目录重跑沙箱专项49/49。首次因未链接workspace内嵌依赖而报Ajv加载错误，补齐依赖映射后通过；启动失败保留。API/Web构建通过。最后扫描发现两处测试占位值和E2B占位参数误报，先留失败再最小澄清，17+2安全测试与扫描通过，未放宽扫描器。最后独立抽核覆盖Kimi出站Schema、admin配置、owner/会话/过期下载、冻结批准、当前权限、平台网络读回、私有存储和隔离HTML；新增Critical/Important阻断项均0，不代表全仓累计静态审查完成。

依赖审计未通过：候选critical1/high11/moderate33，总45；原主线critical1/high12/moderate32，总45，新增E2B到glob中等级链路告警。WES仅调用明确文件读写与执行，未暴露SDK目录上传入口；未为本次合并扩大范围升级SDK。旧集成测试和脚本与基线相同，本轮候选仍templates_status_not_200，原主目录当前环境api_server_not_ready；分别留失败，不修改模板业务数据凑绿。

原长提示120秒超时、后续输入未自动携带业务结构化结果、Office人工编辑以及其他生产环境独立配置继续保留。用户同意合并不自动等于所有这些场景已验收。过程与命令日志引用见总看板events/2026-11-04-wes-skills-local-merge.json。
