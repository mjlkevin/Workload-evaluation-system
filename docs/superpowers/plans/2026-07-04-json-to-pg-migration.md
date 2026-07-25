# JSON 数据迁移到 PostgreSQL 执行计划

日期：2026-07-04

## 目标

将当前后端仍在使用的 JSON 数据对象迁移到 PostgreSQL，并把运行时数据层从文件仓储切换到 PG 仓储。迁移后 JSON 文件仅作为历史备份/一次性导入源，不再作为主读写路径。

## 最新业务口径

- 旧用户全部清空，不保留历史账号；迁移时创建一个管理员用户。
- 邀请码、密码重置令牌全部丢弃。
- `config/versions/records.json` 中的版本/项目评估历史全部丢弃，不导入 PG。
- 版本号规则必须准确迁移到 PG。
- 模板和规则集必须准确迁移到 PG。
- 系统配置必须准确迁移到 PG。
- 团队 JSON 现阶段可丢弃历史数据，但运行时仓储需切到 PG。
- AI 会话 JSON 可丢弃历史数据，但运行时仓储需切到 PG。
- Trace 历史 JSON 可丢弃，但 Trace 能力保留并切到 PG，用于 AI/Agent 执行观测、审计和排障。

## JSON 数据清单

| 文件 | 处理策略 | PG 目标 |
|---|---|---|
| `config/auth/users.json` | 丢弃旧用户，种子管理员 | `users` |
| `config/auth/invite-codes.json` | 丢弃 | `invite_codes` 空表 |
| `config/auth/password-reset-tokens.json` | 丢弃 | `password_reset_tokens` 空表 |
| `config/versions/records.json` | 丢弃历史 | `version_records` 空表 |
| `config/versions/version-code-rules.json` | 准确迁移 | `version_code_rules` |
| `config/templates/example-template.json` | 准确迁移 | `templates` |
| `config/rules/example-rule-set.json` | 准确迁移 | `rule_sets` |
| `config/system/requirement-settings.json` | 准确迁移 | `system_configs` |
| `config/system/implementation-dependency-rules.json` | 准确迁移 | `system_configs` |
| `config/system/knowledge-base-config.json` | 准确迁移 | `system_configs` |
| `config/teams/store.json` | 丢弃历史 | `teams` 系列表空表 |
| `data/ai-sessions.json` | 丢弃历史 | `ai_sessions` 空表 |
| `data/traces/trace-store.json` | 丢弃历史 | `traces` 空表 |

## 执行步骤

1. 新增迁移策略测试，锁定“迁移/丢弃/重置”的决策，防止旧脚本继续导入 `records.json` 或旧用户。
2. 新增/调整 Drizzle schema 与 SQL migration：补齐模板、规则集、系统配置、版本运行表、邀请码、重置令牌、团队、AI 会话、Trace 等表。
3. 改造迁移脚本：支持 dry-run、validate、report；迁移必须保真的配置类资产；重置用户并创建管理员；丢弃明确允许丢弃的历史数据。
4. 切换运行时仓储：auth、versions、system、templates、rules、team、ai-sessions、trace 不再读写 JSON。
5. 更新文档和总看板事件，保留迁移边界、验证命令、残余风险。
6. 执行验证：至少 `npm run build:api`、相关模块测试、迁移 dry-run/validate；可用 PG 时执行 live migration 验证。

## 验收标准

- 迁移脚本不会导入旧用户、邀请码、重置令牌、`records.json`、团队历史、AI 会话历史、Trace 历史。
- 版本号规则、模板、规则集、系统配置迁移后字段与源 JSON 等价。
- 后端运行时不再依赖上述 JSON 文件作为主读写路径。
- API 构建通过；受影响模块测试通过；迁移 dry-run/report 输出可审计。
