# RP-043 User Management Drawer QA

## 结论与边界

| 项目 | 状态 | 结论 |
|---|---|---|
| 实现范围 | 通过 | `/users` 的页面动作、筛选、表格、单用户 Drawer、安全 Dialog、邀请流程与真实持久化已进入本地实现。 |
| 自动化 | 通过 | Web 全量 24 files / 171 tests；Dialog 5 + Drawer 14 + UserManagement 33，共 52/52；API modules handlers 全量回归 52/52，其中包含用户管理/auth 用例。 |
| 本地构建 | 通过 / 已知警告 | Web 与 API 构建通过；Web 仅保留 `>500 kB` chunk-size 已知警告。 |
| 真实浏览器 | 通过 | Google Chrome 管理员会话完成桌面、760px、键盘、焦点、风险确认、密码目标上下文、邀请与恢复检查。 |
| 测试数据 | 已恢复 | 测试用户业务角色已恢复；状态变更与密码重置未提交；测试邀请码已精确删除。 |
| 总看板可见页 | 待安全应用 | 结构化事件单独校验；现有 board HTML 有无关未提交修改，因此本批不运行 apply/generate，不覆盖这些页面。 |
| CI / 合并 / 发布 | 未声明 | 本记录只证明本地自动化、构建和真实 Chrome 验收，不把结果表述为 CI green、已合并或已发布。 |

本轮业务表面限定为 `/users` 用户管理页面族；沿用 `ISS-2026-07-25-003 / RP-043`，不新增重复 Issue 或 RP。`DEF-2026-07-04-002` 作为邀请行为恢复的交叉引用，`RP-041` 仅作为管理员直接新建用户的独立范围交叉引用。

## 环境

| 项目 | 值 |
|---|---|
| 日期 | 2026-07-26 |
| 浏览器 | Google Chrome |
| URL | `http://localhost:3002/users` |
| 身份 | 管理员 `mjlkevin` 的管理视角 |
| 可恢复测试用户 | `testuser-c350d3b3-fa7b-4586-b3da-3585e21578ba` |
| API 服务 | `http://127.0.0.1:3000/api/v1/health` 返回健康状态 |
| Web 服务 | `http://127.0.0.1:3002` 返回 HTTP 200 |
| 桌面视口 | 1440 × 900 |
| 窄屏视口 | 760 × 900 |

## 自动化与构建

| 检查 | 状态 | 结果 |
|---|---|---|
| `npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/Drawer.test.jsx src/__tests__/Dialog.test.jsx src/__tests__/UserManagement.test.jsx` | 通过 | Dialog 5 + Drawer 14 + UserManagement 33，合计 52/52。 |
| `npm run test:web` | 通过 | 24 files / 171 tests。 |
| `npm run build:web` | 通过 / 已知警告 | 构建通过；唯一保留项为 `>500 kB` chunk-size warning。 |
| `(cd apps/api && npx tsx --test --test-global-setup=./test-setup.mts src/modules/modules.handlers.test.ts)` | 通过 | API modules handlers 全量回归 52/52，其中包含登录、`me`、业务角色、管理员重置密码、`listUsers` 等用户管理/auth 用例。 |
| `npm run build:api` | 通过 | API TypeScript 构建通过。 |
| OpenAPI YAML、`operationId` 与本地 `$ref` 检查 | 通过 | 164 个 `operationId` 唯一；135 个本地引用均可解析。 |
| `node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base 13eecc2 -- ui/V2_PROTOTYPE/src/components/ui/Drawer.jsx ui/V2_PROTOTYPE/src/components/ui/Dialog.jsx ui/V2_PROTOTYPE/src/components/UserManagement/UserEditorDrawer.jsx ui/V2_PROTOTYPE/src/api/users.js ui/V2_PROTOTYPE/src/hooks/useUsers.js ui/V2_PROTOTYPE/src/pages/UserManagement.jsx ui/V2_PROTOTYPE/tokens.css ui/V2_PROTOTYPE/components.css` | 通过 | 本批 UI scope checker 无新增 finding。 |

## Desktop 1440 × 900

| 检查 | 状态 | 证据 |
|---|---|---|
| 页面层级 | 通过 | 页面主动作、筛选和用户表格分区清晰，目标行的“编辑”操作可直接到达。 |
| 编辑目标 | 通过 | 点击测试用户行的“编辑”后，Drawer 标题上下文显示正确 username。 |
| 初始焦点 | 通过 | Drawer 打开后初始焦点位于“系统角色”。 |
| 单用户保存与回载 | 通过 / 已恢复 | 将业务角色由 `pre_sales` 改为 `pm` 后保存成功，并由服务端回载确认；随后从 `pm` 恢复为 `pre_sales`。 |
| 脏关闭保护 | 通过 | 修改草稿后请求关闭会打开“放弃未保存修改”；在该 Dialog 按 Escape 返回 Drawer，草稿保持。 |
| 禁用风险确认 | 通过 / 未提交 | `active → disabled` 打开风险 Dialog，显示正确目标和“正常 → 已禁用”；选择取消，没有提交状态变更。 |
| 密码重置上下文 | 通过 / 未提交 | 密码 Dialog 显示正确目标用户；本轮未输入或提交密码。 |
| 最终焦点恢复 | 通过 | 最终关闭工作流后，焦点恢复到对应用户行的“编辑”按钮。 |
| 上下文批量操作条 | 自动化通过 | 本次 Chrome 记录不单独声明批量选择条的视觉验收；其零选择隐藏、选择后出现与批量持久化由 UserManagement 自动化覆盖。 |

## 邀请流程

| 检查 | 状态 | 证据 |
|---|---|---|
| 生成 | 通过 | 生成测试邀请码 `KD-20260726-1877I9`。 |
| 结果上下文 | 通过 | 结果 Dialog 显示邀请码、`active` 状态和创建时间；没有伪造后端不存在的有效期。 |
| 复制反馈 | 通过 | 点击复制后界面反馈 `已复制 KD-20260726-1877I9`。 |
| 剪贴板边界 | 已说明 | Chrome Browser Use 虚拟剪贴板与页面系统剪贴板隔离，因此没有用 connector clipboard 做二次断言；UI 成功反馈与自动化中的 `navigator.clipboard.writeText` 调用断言共同作为证据。 |
| 数据清理 | 已恢复 | QA 后从 `config/auth/invite-codes.json` 精确移除 `KD-20260726-1877I9`，该文件恢复 clean。 |

## 760 × 900

| 检查 | 状态 | 证据 |
|---|---|---|
| Drawer 尺寸 | 通过 | Drawer width = 760，viewport width = 760，为全宽工作区。 |
| Drawer body | 通过 | body `overflowY=auto`，内容区可独立滚动。 |
| Footer 可达性 | 通过 | footer top = 831、bottom = 900，完全位于视口内，取消和保存操作可达。 |
| 模态隔离 | 通过 | 底层点击测试点归属 Drawer，页面未成为可编辑表面。 |
| 页面纵向到达 | 通过 | 文档 `scrollHeight=2027`、`clientHeight=900`，主内容可通过正常纵向滚动到达。 |
| 页面横向溢出 | 通过 | `scrollWidth=clientWidth=745`，没有页面级横向溢出。 |
| 表格操作 | 通过 | 表格列在窄屏压缩，行级“编辑”仍可到达。 |
| 响应式 shell | 现有行为 / 流程可达 | 窄屏下 sidebar 位于主内容上方是现有 responsive shell 行为；本轮不把它登记为缺陷，用户管理流程仍可到达。 |

## Keyboard

| 检查 | 状态 | 结果 |
|---|---|---|
| 进入 Drawer | 通过 | 打开后焦点进入“系统角色”。 |
| Tab 环 | 通过 | 从最后一个“保存变更”继续 Tab 会回到“关闭编辑用户”，焦点保持在 Drawer 内。 |
| 脏状态 Escape | 通过 | Drawer 的 Escape 遵循脏关闭策略，打开“放弃未保存修改”。 |
| 嵌套 Dialog Escape | 通过 | 放弃 Dialog 的 Escape 返回 Drawer，未丢失草稿。 |
| 最终关闭 | 通过 | 关闭后焦点恢复到触发该工作流的“编辑”按钮。 |

## Console

| 检查 | 状态 | 结果 |
|---|---|---|
| QA 时间窗 | 通过 | 从 `2026-07-26T05:30:00Z` 起，本轮 QA 期间 Chrome console 的 warning/error 为空。 |
| 历史 HMR 记录 | 非当前缺陷 | `2026-07-26T05:27:00Z` 左右的 `applyBusinessRole` HMR 错误属于开发热更新瞬态；当前刷新、构建和运行均未复现，因此不登记为当前缺陷。 |

## 数据恢复清单

- [x] 测试用户业务角色完成 `pre_sales → pm` 服务端保存与回载验证。
- [x] 同一测试用户业务角色完成 `pm → pre_sales` 恢复。
- [x] 禁用风险 Dialog 选择取消，账户状态未提交。
- [x] 密码 Dialog 只验证目标上下文，未提交密码。
- [x] 测试邀请码 `KD-20260726-1877I9` 已从邀请记录中精确移除，邀请文件恢复 clean。

## 截图

| 视图 | 相对链接 |
|---|---|
| Desktop 用户管理页 | [2026-07-26-user-management-desktop.jpg](./2026-07-26-user-management-desktop.jpg) |
| Desktop 编辑 Drawer | [2026-07-26-user-management-drawer-desktop.jpg](./2026-07-26-user-management-drawer-desktop.jpg) |
| 760px 用户管理页 | [2026-07-26-user-management-760.jpg](./2026-07-26-user-management-760.jpg) |
| 760px 全宽 Drawer | [2026-07-26-user-management-drawer-760.jpg](./2026-07-26-user-management-drawer-760.jpg) |

## 总看板回填状态

本次新增 `2026-07-26-user-management-drawer-implementation.json` 作为 RP-043 实现与本地验收事件。事件通过 `board-event-check` 后仍暂不 apply：`index.html`、`issues.html`、`defects.html`、`requirements.html`、`plan.html`、`testing.html`、`monitoring.html`、`risks.html`、`changes.html` 与 `sources.html` 均存在本任务之外的未提交修改。待这些修改分离或提交后，再由有权限的 Codex/用户应用事件并运行看板一致性检查。
