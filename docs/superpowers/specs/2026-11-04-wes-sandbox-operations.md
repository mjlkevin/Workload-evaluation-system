# WES 沙箱接入与运行说明

关联：RP-067；设计见 `2026-11-04-wes-sandbox-invocation-design.md`。本地候选实现，真实云、真实模型文档验收及生产启用仍须分别登记。

## 配置与部署

1. 保留现有 `CREDENTIAL_KEK`，按既有凭据域部署规范加载；不得写入代码、日志、看板或浏览器 URL。应用使用 E2B JavaScript SDK 2.31.0。
2. 在目标 Harness PostgreSQL 执行 `npm run db:migrate -w apps/api`，迁移 0031/0032 新增连接、任务、产物和执行审计。先核对数据库目标，测试使用 `scripts/verify-local-db-tests.sh` 的双 URL 保护。
3. 将 `WES_SANDBOX_ARTIFACT_DIR` 指向持久私有目录；默认 `config/private-sandbox-artifacts` 已 gitignore。目录仅服务账号可写，不能通过静态服务器公开；部署需一并备份数据库元信息和文件字节。首期为单实例本地磁盘，多实例部署前需独立存储方案。
4. 管理员使用 `PUT /api/v1/system/sandbox-connections` 保存 default 连接。字段为 workspaceId、cn-beijing、模板公开 code、固定 ready 构建 ID、aliyunUid、enabled。独立按量付费 Key 只通过请求正文 `apiKey` 写入既有加密凭据库；GET 仅返回是否配置与版本。临时验收 Key 不自动保存为生产配置。
5. 调用 `POST /api/v1/system/sandbox-connections/test` 只读检查；该操作不创建实例。模板必须能证明固定构建就绪、没有额外环境变量/挂载、allowOut 为空并拒绝全部 IPv4/IPv6 出站。实例创建和重连还会读回核验平台实际策略：禁止公网，只接受两个固定系统 OSS 内网通道。用户已明确接受这一范围，不宣称完全断网。云端未返回足够隔离信息时检查失败，不按“默认安全”放行。修改模板或凭据后应重新检查和确认任务。

## 消息与执行

普通工作台宿主可向 LLM 提供 `sandbox_execute`；工具只在持久 Harness Run 中运行。选择 Skill 仍先由 LLM 理解用途：介绍/追问不执行；可选择原能力分析、直接整理文件，或先分析后生成文件。后续文件 Run 引用上游结果，失败不覆盖已完成的分析。

发起执行时服务器冻结代码、材料引用与 hash、输出格式和连接身份，中央消息流展示材料、格式、时限及完整代码。逐次外发确认使用既有持久审批；无批准不创建实例。身份取自宿主，模型不能传 owner、session 或任意文件路径。

每任务独立实例；每用户 1 个、全局 4 个；最多 3 次代码执行；命令 120 秒、活动任务 300 秒、TTL 900 秒。输入最多 8 个/20 MiB，产物最多 5 个/单个 20 MiB/总计 50 MiB。代码仅在云端以非特权用户运行，不在 WES 宿主执行；不联网安装包。Python 标准库可构建 OOXML；依赖应预装进模板。

## 文件与恢复

文件由服务器从任务目录读取、按 HTML/OOXML 结构校验后保存；PG 登记成功后才在消息中交付下载入口。HTML 在无脚本、无同源权限 iframe 中预览；DOCX/XLSX 下载到本地打开。下载使用 Bearer fetch Blob，不把 JWT 放链接。

文件从发布时起保留 30 天，检查 owner、会话和过期状态；不提供公共永久 URL。释放实例后文件仍可下载。归档会话或过期立即拒绝读取，后台清理不影响权限生效时间。

代码派发前后分别记录 attempt、代码 hash、开始/结束与退出状态；已知实例 ID 立即持久化。worker 丢失后不盲目重放未知代码；同一有效执行重入返回正在处理。取消/租约失效阻止后续产物发布。每 15 秒的应用维护器处理关联文件 Run、托管实例回收和过期文件；回收失败保留 pending，TTL 是补偿。维护器不是 Codex 自动化或需求池实现 Loop。

## 验证口径

单元测试和真实 PostgreSQL/Harness 测试使用合成云适配器，证明本地权限、确认、恢复、文件和审计行为；不证明百炼真实网络隔离或真实模型生成质量。真实云验收必须单独记录模板、云请求、生成的三种文档、释放结果以及文件打开检查，不能用手动创建实例或早期 API smoke 替代。

## 2026-11-04 实测边界

验收专用模板为 `WES-docs-controlled-20261104`，code `f902c2af-a5bf-49c9-829d-bc704b8c798d`、固定 ready build `36d6e887-df67-4a8f-af5e-5cbc209a03ad`；原模板未修改。实例强制保留两个系统 OSS 内网通道，用户已确认接受平台隔离；创建及重连读回检查会拒绝额外出口。TCP建立连接不等于取得HTTPS内容，固定公网目标完整HTTPS实测未取得响应。不承诺OS网络命名空间或完全断网。

真实云合成脚本生成三类文件并释放实例；uid1000、环境仅PATH/HOME/LANG，stdout/stderr各限16KiB，超时返回124。模型代码通过非交互脚本执行，必须逐个写入当前工作目录下的输出文件；BytesIO、最后表达式和打印结果不会被自动保存。

接口依据：[创建模板](https://help.aliyun.com/zh/model-studio/sandbox-api-template-create)、[创建实例](https://help.aliyun.com/zh/model-studio/sandbox-api-create)。临时Key未保存连接或凭据配置，生产另配独立Key。
