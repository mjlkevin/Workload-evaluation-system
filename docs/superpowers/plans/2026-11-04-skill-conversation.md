# Skill 对话上下文实施计划

用户已批准交互设计。本轮由当前会话一次性执行，不启动实现 Loop 或子代理。

**Goal:** 让带 Skill 标签的输入先由 LLM 理解，必要时追问，明确任务才进入原有执行器。
**Architecture:** 新增 skills.conversation 服务和 PG 对话仓储，通过 ai-executions/conversation 入口处理。模型适配复用 generation 绑定；执行仍调用原有 invocation。前端 hook 只发送用户内容与受控引用，不自行填输入或弹出参数表。
**Tech Stack:** Express / TypeScript / PostgreSQL / React / Vitest / node:test。

- [x] 1. 服务端 RED：skills.conversation.test.ts 覆盖reply、clarify、execute、拒绝非法输入与过期上下文，观察缺失模块失败。
- [x] 2. 最小实现：共享已绑定模型装配；服务端读取能力、会话、材料；有限决策输出校验；原子保存对话；执行复用幂等队列。通过 focused tests。
- [x] 3. 前端 RED：composer-business-invocation.test.jsx 覆盖选中不触发、用途答复、追问后补充、刷新与错误/会话隔离，观察旧直接执行路径失败。
- [x] 4. 最小实现：useComposerBusinessTask 调 conversation API，保留标签和上下文；消息格式化和气泡显示历史标签；去掉本通道参数弹窗。
- [x] 5. 验证：npm run test:web、build:web、build:api；通过 verify-local-db-tests.sh 在独立测试库运行test:modules及新增持久化/路由测试；检查UI范围和权限数据流。
- [x] 6. 浏览器：3006当前登录用户真实用途问答、追问、补充执行与刷新；保存截图、Run及语义证据。回填原issue/defect及设计、计划、测试、监控、风险、变更和来源页。保留既有后台测试失败证据。

- [x] 7. 用户追加气泡来源区分：先写 message-meta-bar 回归断言，再使用现有Tailwind token桥接添加“你”/“AI”可见标识和用户浅色底；保留复制、时间和富文本；1440/760截图验证。
- [x] 8. 补齐混合消息历史：从队列已落库的 canonical user/message 事实幂等写回原快照，保留既有整会话历史回落规则；新增持久化回归，验证原始正文完整且只出现一次。


最终验证：Web101文件991/991、双构建与UI范围检查通过；对话单测13、持久化5、路由及推荐回归7通过。模块1174/1176，既有取消时序2例保留。真实模型用途回答、缺原文追问、刷新恢复及两次明确任务拆解已观察；用户最终验收仍待确认。完整证据见 `docs/superpowers/evidence/2026-11-04-skill-conversation-and-message-senders.json`。


## 后续截图反馈，按两个业务表面顺序处理

1. 工作台执行输入：命中ISS-2026-11-04-001/RP-050，原任务输入并非用户原话，改为中性执行参数、默认折叠；参数值与历史事实保持。先写角色/折叠回归，再运行工作台相关测试和浏览器验证。
2. 系统管理导航壳：命中ISS-2026-10-21-001/RP-065。移除SystemManagementNav挂载及专用废弃组件，从现有Sidebar各菜单直接路由，保留解析、旧路由和页签缓存；更新导航用例，验证Skill/模型/Workflow独立入口及1440/760可达性。两个表面分别检查，不扩展其他页面内容。
