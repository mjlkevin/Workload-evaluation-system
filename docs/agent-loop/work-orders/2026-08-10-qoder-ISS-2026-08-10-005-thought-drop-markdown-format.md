# 工单 · ISS-2026-08-10-005：AI 工作台流式内容层修复——思考块可见（thought 事件空窗丢弃）+ 回答 Markdown 排版（提示词规范 + 解析器容错）

> 状态：**已派发 / 待 KIMIK3 回填（2026-08-10 用户批准编制与派发，合入须用户批准 --no-ff）**
> 类型：defect（P1 高频核心流）· 来源：用户复测实测截图 1 张（2026-08-10 14:44，服装行业特性功能问答）
> 交叉引用：ISS-2026-08-10-004（异步流式管道，已合入 3e562f3，本单是其复测衍生的内容层问题，相关但独立）/ ISS-2026-08-10-003（提交后刷新即时性，已合入 ee547a5）/ ISS-2026-08-10-001、002（角标链路，已验收关闭，**不得触碰**）
> 关联缺陷：DEF-2026-08-10-001
> base：`dc879f7`（main HEAD，派发时实填；含本工单文档，handoff 回填在分支内完成）

## 1. 业务症状

用户在 AI 工作台发问后（异步通道，逐字流式已通）：

1. **无思考过程块**：字是一个一个吐出来的，但吐的全是回答正文，全程看不到模型思考过程；用户期望对标业内 AI 工具（DeepSeek/Kimi/ChatGPT）：思考是思考、回答是回答；
2. **回答格式散乱**：回答中的 `##1.`、`##2.` 等标题标记以纯文本裸显，列表项与标题挤成一整个段落，仅行内 `**粗体**` 正常渲染；
3. **链路其余正常**：停止按钮、右下角角标/通知、顶栏角标、落库内容均正常——**这些链路不得改动**。

## 2. 根因（已核验 + DB 实证，置信度高，两个独立缺陷）

### 缺陷 A：思考块不可见——前端 THOUGHT 分支空窗丢弃（唯一根因）

- **思考事件有源（DB 实证，原「模型无源」判定已证伪）**：kimi-k2.5 默认思考模式产出 `reasoning_content`，004 层 2 管道正常工作——PostgreSQL `harness_run_events` 实测 **`thought` 事件 817 条 / `text.delta` 1616 条**；
- **丢弃点**：`ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/hooks/useChatMessages.js` L265-279 `handleStreamEvent` 的 `THOUGHT` 分支依赖 `streamingMessageIdRef.current` 定位目标消息，该 ref 仅在首个 `text.delta` 到达时才建立（L243-263）；而思考流天然先于回答流到达——**空窗期内全部 thought 事件静默丢弃**（L277 `return prev`）；
- **次生问题**：即便 ref 已建立，当前实现是**每条 thought 事件追加一个独立 block**（L274 `thoughts: [...thoughts, { text, collapsed: true }]`）——817 条事件会产生 817 个「思考过程 N」折叠块，且 `collapsed: true` 使流式期间思考不可见；
- **展示位置**：`MessageBubble.jsx` L38-82 思考块渲染在回答正文（`RichAiMessage`）**下方**，与业内惯例（思考在上、回答在下）相反。

### 缺陷 B：回答格式散乱——模型紧凑输出 + 解析器严格（两层）

- **模型输出层（落库实证）**：`data/ai-sessions.json` 落库原文证实模型输出本体为**单行紧凑 pseudo-markdown**——`##1.商品与SKU管理-**多维属性矩阵**：...##2.产品生命周期（PLM）-**款式档案**：...` 全部挤在一行（`##` 后无空格、列表项无换行）。**传输管道全程保留换行，非管道丢失**（provider parseStream → run 事件 → SSE → 前端 JSON.parse 逐段验证）。诱因：`apps/api/src/services/ai/handlers/model-answer.ts` L25-44 与 `knowledge-query.handler.ts` L165-177 的系统提示词仅要求「简洁回答」，**无任何排版规范**；
- **渲染层**：前端自研逐行解析器 `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/utils/markdownBlocks.js` 要求严格——标题须 `#{1,6}` + **空格** + 独立行（L152）、列表须换行分隔（L161-162）；单行紧凑输出整体降级为一个段落，仅 `renderInlineMarkdown` 的行内 `**粗体**` 幸存。

## 3. 修复方案（三项，对标业内通行做法）

### 项 1：思考是思考（前端，中改）

1. `useChatMessages.js` `THOUGHT` 分支兜底：`streamingMessageIdRef.current` 为空时**挂到当前 loading 占位消息**（与 TEXT_DELTA L253-256 同款查找逻辑），并把 ref 指向该消息——思考事件零丢失；
2. **聚合为单一思考块**：同一消息的 thought 事件**累加合并到 `thoughts[0].text`**（不再每条事件一个 block），流式期间 `collapsed: false`（实时可见）；
3. **终态自动折叠**：`RUN_COMPLETED/RUN_FAILED/RUN_CANCELLED` 分支（L281-296）在清理 streaming 标记时将该消息 `thoughts[0].collapsed` 置 `true`；
4. `MessageBubble.jsx`：思考块移到回答正文（`RichAiMessage`）**上方**；折叠态标签显示「已思考」（可点开），流式期间显示「思考中…」。

### 项 2：回答是回答——提示词排版规范（后端，小改）

`model-answer.ts` 与 `knowledge-query.handler.ts` 的系统提示词各追加排版规范段（两 handler 覆盖同步/异步双通道）：

```text
【输出排版规范】
- 使用标准 Markdown：标题写作「## 标题」（# 后必须有空格，且独占一行）；
- 列表项各自独占一行，以「- 」或「1. 」开头；
- 小节之间用空行分隔；不要使用「##1.」「-**」等无空格、无换行的紧凑写法。
```

### 项 3：回答是回答——解析器容错（前端，小改，零新依赖）

`markdownBlocks.js` 增强对模型紧凑输出的容错（提示词是劝导、解析器是兜底，两者都要）：

1. 行首标题宽容：`##1.商品`（`#` 后无空格）解析为 heading；
2. 行内 `##` 分段：代码块外的段落文本中，`#{2,6}` 后紧跟数字/中文/英文且前文非行首时，切分为新 heading 块；
3. 紧凑列表拆分：`-**` 等紧邻前文的列表标记切分为独立列表项；
4. 以 `data/ai-sessions.json` 中服装行业回答原文（单行 1265 字符样本）为测试夹具验证端到端分块；
5. **禁止引入新 UI 依赖**（react-markdown/marked 等库替换属架构决策，未经用户单独批准不得实施；若执行中判断自研解析器无法兜底，停止并在 handoff 中申报）。

### 明确禁止

- 不得改 `useBackgroundRuns.jsx` provider 链路 / 通知机制 / 统一视图刷新时机（ISS-001/002/003 验收口径）；
- 不得改后端 provider / workflow / SSE 端点（004 管道已验收，本单后端仅提示词字符串）；
- 不得改 503 回退同步路径与 `submitRun` 提交流程；
- 不得引入任何新 npm 依赖（含 Markdown 渲染库）；不得触碰 `UserManagement` 相关页面（另一会话 WIP）；
- 不得重启后端进程（tsx 无 watch，合入后由指挥方统一重启生效）。

## 4. Allowed Paths

- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/hooks/useChatMessages.js`
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx`
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/utils/markdownBlocks.js`
- `ui/V2_PROTOTYPE/src/__tests__/streaming-ux.test.jsx`（新增用例）
- `ui/V2_PROTOTYPE/src/__tests__/markdown-blocks.test.jsx`（新建，解析器容错夹具测试）
- `apps/api/src/services/ai/handlers/model-answer.ts`（仅系统提示词字符串）
- `apps/api/src/services/ai/handlers/knowledge-query.handler.ts`（仅系统提示词字符串）
- `apps/api/src/services/ai/workbench-dispatch.service.test.ts`（仅新增 systemPrompt 排版规范断言）
- `docs/agent-loop/work-orders/2026-08-10-qoder-ISS-2026-08-10-005-thought-drop-markdown-format.md`（handoff 回填）

## 5. RED 要求（≥4，先贴红输出再修）

1. 前端新增：thought 事件在首个 text.delta **之前**到达时挂到 loading 占位消息且不丢失 → 修复前红（当前静默丢弃）；
2. 前端新增：同一消息多条 thought 事件聚合为**单一思考块**（thoughts 长度恒 1、text 累加）→ 修复前红（当前每条事件一个 block）；
3. 前端新增：终态事件后思考块 `collapsed=true`，且 MessageBubble 渲染顺序中思考块位于回答正文上方 → 修复前红；
4. 前端新增（markdown-blocks.test.jsx）：`##1.商品与SKU管理`（无空格）解析为 heading；服装行业单行紧凑样本解析出 ≥5 个 heading 且列表项独立成块 → 修复前红；
5. 后端新增：dispatch 链路传给模型的 systemPrompt 含「输出排版规范」段（model-answer 与 knowledge-fallback 两路）→ 修复前红。

## 6. 验证矩阵

- `npm run test:web` ≥288 全绿（含新增用例）；
- `npm run test:modules` ≥321 全绿；
- `npm run test:ai` 全绿（AI handler 边界）；
- `npm run build:web`、`npm run build:api` 零错误；
- UI 范围门禁：`node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base <base实填> -- <变更的 ui 文件>` 零新增确定性债；
- `git diff <base实填> -- apps/ ui/ package-lock.json` 输出路径全部落在 Allowed Paths（package-lock.json 必须零变更）；
- 主检出零接触：执行全程在 worktree 内，不碰 main 工作区脏页。

## 7. 分支与提交

- 分支：`qoder/iss-2026-08-10-005-thought-drop-markdown-format`，worktree `/Users/kevin/AI/wes-worktrees/iss-2026-08-10-005`，从 main HEAD 切（base 实填后即为工单文档在库版本）；
- 开工前置：完成 Worktree Contract ACK；worktree 内 `npm install`（根 + `ui/V2_PROTOTYPE/`）双零退出码；触碰 UI 前先 `npx ui-skills start`（单业务表面 = AI 工作台对话区，≤3 根问题：thought 丢弃 / 思考块位置 / 解析器容错）；
- 提交规范：`type(scope): 中文描述`，聚焦「为什么」；
- 合入须用户批准，一律 `--no-ff`；后端提示词变更合入后由指挥方重启后端生效；
- 回填状态只允许「已回填 / 待 Codex 复核」，不得自行宣布「已交付」。

## 8. Handoff 格式

按 `docs/codex-workflows/external-ai-handoff-template.md` 回填（本工单文档底部）：目标、改动文件清单（对 Allowed Paths）、RED 先红证据、验证矩阵输出、风险与范围外观察、看板同步建议、下一步。

## 9. 验收口径（人工复测 MT-ISS0810-005-001）

1. 发问后**思考块先于回答出现**：流式期间展开滚动显示思考内容，回答开始输出后在回答上方自动折叠为「已思考」（可点开查看）；
2. 回答标题 / 列表正确分块渲染：不再裸显 `##1.` 文本、不再整段挤一行（用「服装行业的特性功能有哪些」同类问题复测）；
3. 切会话再切回内容与流式结果一致；刷新页面后历史消息渲染同样正确；
4. 停止按钮可取消、右下角角标/通知、顶栏角标不回归（ISS-2026-08-10-001/002/003/004 既有口径）；
5. **ISS-2026-08-10-004 复测第 1 项「思考块可见」随本单一并复测**；004 第 3/4 项与 003 第 1/3/4 项保持可独立复测状态。

---

# Handoff 回填（KIMIK3 · 2026-08-10）· 状态：已回填 / 待 Codex 复核

## 目标
ISS-2026-08-10-005（流式回答无思考块 + Markdown 格式散乱）：三项修复全部落地——
① 思考是思考（THOUGHT 空窗兜底挂 loading 占位零丢失 + 多事件聚合单块 + 终态自动折叠 + 思考块移到回答上方）；
② 提示词排版规范（model-answer 与 knowledge-fallback 两路系统提示词补【输出排版规范】段）；
③ 解析器容错（## 无空格 / 行内 ## 分段 / -** 紧凑列表，服装行业落库原文夹具端到端验证）。
边界守住：004 流式管道、角标/通知链路、503 回退路径、submitRun 提交流程零改动；零新 npm 依赖；未重启后端；主检出零接触。

## Worktree
- projectRoot: /Users/kevin/AI/Workload-evaluation-system
- worktreePath: /Users/kevin/AI/wes-worktrees/iss-2026-08-10-005
- branch: qoder/iss-2026-08-10-005-thought-drop-markdown-format
- baseCommit: dc879f7（worktree HEAD 3a8426d 仅多 base 实填一行）
- taskId: ISS-2026-08-10-005 / DEF-2026-08-10-001
- fix commit: 2f2d8c6

## 变更文件（对照 Allowed Paths：8/8 全部在清单内，lockfile 零变更）
- ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/hooks/useChatMessages.js：THOUGHT 分支空窗兜底（ref 为空时挂当前 loading 占位并建立 ref）+ 聚合为单一思考块（流式 collapsed:false）+ 终态事件置 collapsed:true；TEXT_DELTA 首个增量遇 loading 占位时替换占位文案（修复中实测发现的连带缺陷：兜底建立 ref 后旧逻辑会把回答追加到「正在理解你的问题」之后）。
- ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx：思考块移到回答正文上方；折叠态「已思考」（可点开）、流式「思考中…」、非流式展开「思考过程」。
- ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/utils/markdownBlocks.js：新增围栏感知预展开 expandCompactSegments（行内 #{2,6} 后紧跟数字/中英文切 heading、行内 -** 切列表项）；行首标题 # 后空格可选；无序列表标记空格可选但排除 ---/*** 纯标记行。普通连字符（设计-打样-采购、提前6-12个月、Color-SizeMatrix）实测不误伤。
- ui/V2_PROTOTYPE/src/__tests__/streaming-ux.test.jsx：新增 5 用例（空窗兜底零丢失 / 单块聚合 / 终态折叠 / MessageBubble 顺序与「已思考」/ 流式「思考中…」）；hook 级测试经 vi.mock(importOriginal) 仅拦截 useRunEventStream 捕获 onEvent，其余导出原样，页面级旧用例不受影响。
- ui/V2_PROTOTYPE/src/__tests__/markdown-blocks.test.jsx（新建）：服装行业落库原文紧凑单行夹具（data/ai-sessions.json 实样提取，紧凑段 1055 字符）端到端分块 + 误伤守护 + 标准写法不回归，共 4 用例。
- apps/api/src/services/ai/handlers/model-answer.ts：仅系统提示词字符串追加【输出排版规范】4 行。
- apps/api/src/services/ai/handlers/knowledge-query.handler.ts：仅知识库兜底系统提示词字符串追加同款 4 行。
- apps/api/src/services/ai/workbench-dispatch.service.test.ts：仅新增 2 条 systemPrompt 排版规范断言（domain_qa 路 + knowledge fallback 路）。

## RED 先红证据（修复前实跑，9 个新用例全红）
- `npx vitest run src/__tests__/markdown-blocks.test.jsx src/__tests__/streaming-ux.test.jsx`：Test Files 2 failed；Tests 7 failed | 6 passed——红：行首标题宽容、服装样本端到端、空窗兜底、单块聚合、终态折叠、思考块位置/已思考、思考中…（既有 6 个页面级用例全绿未回归）。
- `npx tsx --test --test-name-pattern='ISS-005' workbench-dispatch.service.test.ts`：fail 2 / pass 0——两路 systemPrompt 均无【输出排版规范】段（红输出含完整提示词原文佐证）。

## 验证命令与结果（修复后 worktree 内实跑）
- `npm run test:web`: pass——Test Files 43 passed (43)，Tests 297 passed (297)（≥288 ✓，含 9 个新用例）。
- `npm run test:modules`: pass——tests 323 / pass 323 / fail 0（≥321 ✓；首轮 300s 超时被杀，重跑 EXIT=0 全绿，日志 /tmp/wes-test-modules.log）。
- `npm run test:ai`: pass——tests 260 / pass 260 / fail 0（EXIT=0，日志 /tmp/wes-test-ai.log）。
- `npm run build:web`: pass——✓ built in 666ms，EXIT=0。
- `npm run build:api`: pass——tsc 零错误，EXIT=0。
- UI 范围门禁 `node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base dc879f7 -- <5 个变更 ui 文件>`: pass——「No new deterministic UI findings.」EXIT=0。
- `git diff dc879f7 --name-only -- apps/ ui/ package-lock.json`: 8 个路径全部落 Allowed Paths，package-lock.json 不在 diff 中（零变更 ✓）。

## 风险
- 人工验收缺口：思考块流式可见/终态折叠、服装类问题排版复测（MT-ISS0810-005-001 五项）需用户在浏览器实机复测；本次为 jsdom 行为级证据，未做 1440/760 视口截图（行为修复无视觉样式变更，样式沿用既有 inline style 与 token）。
- 兼容：行首 `#` 无空格即判 heading（如 `#tag` 行文开头会被视为一级标题）——容错取舍，业务回答场景实测无此行文；`---` 分隔线与普通连字符已显式守护。
- 后端提示词变更合入后须由指挥方重启后端生效（tsx 无 watch，本单未重启进程）。
- 范围外观察（不处理，仅申报）：① 落库样本中知识库未配置（missing_config）导致回答走通用知识兜底，与 004 复测环境一致，非本单范围；② 行内 `##` 容错对 `##实施建议` 后无标点的长尾文本会整体并入 heading 文案，渲染仍优于整段裸显，如后续模型仍高频紧凑输出可再细化切分规则。

## 是否需看板同步
是（建议由 Codex/用户终审后落板，本单不直接改看板）。建议页面：
- defects.html：DEF-2026-08-10-001 状态建议更新为「已回填 / 待 Codex 复核」，挂 fix commit 2f2d8c6 与验证证据。
- testing.html：登记 9 个新自动化用例（streaming-ux 5 + markdown-blocks 4 + dispatch 2）与 MT-ISS0810-005-001 待人工复测。
- changes.html：登记本单三项修复与验证矩阵结果。

## 下一步建议
- 待 Codex 复核（diff 范围 / RED 证据 / 验证矩阵可重放）→ 用户批准 --no-ff 合入 → 指挥方重启后端 → 用户按 MT-ISS0810-005-001 人工复测（含 004 第 1 项一并复测）。
