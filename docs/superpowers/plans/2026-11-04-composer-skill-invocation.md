# 工作台 / 技能调用实施计划

**Goal:** 将用户已确认的 / 清单、标签和统一发送落到现有验收环境。
**Architecture:** 复用业务执行目录、execution-sources、runs 与既有动态参数表单；命令选择不调用后端启动。
**Tech Stack:** 既有 React/Vite、Tailwind tokens、Testing Library/Vitest。单次任务、串行执行，不创建实现 Loop。

设计依据：`../specs/2026-11-04-composer-skill-invocation-design.md`。用户已确认方案。隔离工作区已有 codex/wes-skills-c，基线 9bbdc5a；保留 model-verify-status.json 既有修改；主目录不改业务源代码。

- [x] 记录 ISS-2026-11-04-001 → RP-050 范围补充与批准方案，更新计划/设计/来源。
- [x] RED：新增 composer-slash-command.test.jsx 覆盖命令筛选、键盘/输入法、选择不启动、正文保留和移除标签；新增 composer-business-invocation.test.jsx 覆盖真实提示词/附件、缺参、失败重试、跨会话隔离。
- [x] GREEN：新建 ComposerTaskPicker.jsx、useComposerBusinessTask.js、ComposerTaskParameters.jsx；最小改动 Composer.jsx、ChatArea/index.jsx 和工作台 index.jsx，替换旧按钮。
- [x] 更新业务入口与状态同步用例，验证清空草稿只发生在同一会话、同一发送快照成功之后。
- [x] 执行 `npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/composer-slash-command.test.jsx src/__tests__/composer-business-invocation.test.jsx src/__tests__/business-workbench-entry.test.jsx src/__tests__/business-status-sync.test.jsx`，预期全部通过。
- [x] 执行 Web 回归、`npm run test:modules`、`npm run build:web` 和 UI 范围检查；保留既有失败记录，不修改其断言或预算。
- [x] 3006 浏览器实测选择/参数/实际发送/刷新，1440/760 检查与截图；同步测试、监控、变更、需求和来源看板，用户验收保持待回填。

不在本任务改动后端接口、已发布 Skill 定义或其他页面；不推送、不合主线。

验证收口：Web最终101文件988/988（2 workers）；定向36/36；build:web与UI范围检查通过。模块1157/1159，两个既有取消/超时失败保留；同文件隔离66/66。首次Web5项管理页超时，隔离34/34；中间一轮包含标签RED变更，最终冻结源重跑988/988。实际Skill Run54e994ac-d827-4570-bfda-c92fe50c055b完成两条拆解，1440/760及缺参取消保护通过。附件共编已实测，附件新路径真实模型提交未重跑；此项由定向测试证明请求引用。最终用户验收待回填。
