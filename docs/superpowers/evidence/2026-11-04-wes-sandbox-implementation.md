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
