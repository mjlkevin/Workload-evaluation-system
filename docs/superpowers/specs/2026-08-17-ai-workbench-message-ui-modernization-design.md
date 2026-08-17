# AI 工作台对话界面现代化设计

- 日期：2026-08-17
- 范围：`ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/**` 对话相关组件的视觉与结构重设计
- 前置依赖：Tailwind v4 基础设施（见 `AGENTS.md` §6 样式方案决策，2026-08-17 已落地），本次所有改造组件优先使用 Tailwind utility class

## 背景与目标

现有 AI 工作台对话界面存在两个问题：
1. 每条消息都带"AI"/"我"两个方块头像 + 一个带背景色/边框的气泡容器，视觉噪音大，不符合现代 AI 对话产品（如 Claude.ai）的极简趋势。
2. 消息内的辅助信息（思考过程、工具调用、知识检索、记忆引用）分散渲染在气泡内两个不同位置，各自独立展开/折叠，缺乏统一的信息层级。

设计参考对象：[beautifului.dev](https://beautifului.dev) 公开的 AI 原生界面组件模式库（Loading State / Thinking / Streaming Text / Approval Card / Tool Chips / Task Rows / Chat / Prompt Bar / Recommendation Card / Context Cards）。**本设计只借鉴其交互模式与信息层级思路，不复制其源码**——所有实现基于 WES 现有数据模型原创编写，使用项目自身的 Tailwind 桥接变量（`bg-ink`/`text-ink-3` 等）和组件约定。

## 非目标（明确排除，避免范围蔓延）

以下 beautifui 特性因缺乏对应后端数据或超出"前端优化"边界，本次不做：
- **内联来源引用**（回答内可点开的引用来源列表）——WES 无引用来源字段，需要后端新增数据模型，留作独立需求
- **Thinking 固定 Tab 分类**——WES 的思考轨迹数据（thoughts/toolCalls/knowledgeTool/memoryRef）经常只有部分类别同时存在，做成固定 4 Tab 会出现大量空 Tab；改为动态分组（见下）
- **Task Rows 子步骤嵌套**——WES 的 `run` 对象无子步骤数据，只做到任务列表这一层
- **Prompt Bar 新增能力**（@ 提及数据源 / 斜杠命令 / 模型选择器 / 语音听写）——功能性扩展，非视觉问题，留作独立需求
- 不做任何后端 API / 数据契约改动，纯前端 UI 层重构

## 组件改造清单

### 1. 消息外壳（MessageBubble.jsx）

**移除**：
- `.ai-avatar`（AI/我头像方块）整体删除
- `.ai-bubble-wrap` 的 `padding`/`border`/`background`/`box-shadow` 全部清空

**新布局**：
- assistant：左对齐，`text-ink`，字重 normal；若消息带 `artifacts`（报告等结构化产物），沿用现有宽幅布局逻辑，不受气泡宽度约束
- user：右对齐，`text-ink`，字重 medium（`font-medium`），max-width 约 70% 避免长消息占满整行
- 两者仅通过对齐方向 + 字重区分角色，不使用头像或背景色

**错误态例外**：`message.error` 不再使用红色实底卡片，改为左侧 2px 红色竖线（`border-l-2 border-err`）+ 红色文字，无背景色，与整体无容器基调一致但保留可扫描的警示感

**meta 栏**（复制按钮 + 时间戳）：悬浮显隐交互不变，位置从"气泡下方右侧固定"改为跟随消息角色的对齐方向（assistant 左对齐，user 右对齐）

**Loading 状态**：`LoadingState.jsx` 无需改动——原本挂载在气泡容器内，容器移除后自然呈现为裸露在文本流中的效果

### 2. 统一思考轨迹（新组件 ThinkingTrace，替代分散的 thoughts 块 + ModelRunTrace）

合并 `message.thoughts`、`message.toolCalls`、`message.knowledgeTool`、`message.memoryRef` 四类数据到一个统一的可展开区域：

- 折叠态：单行摘要 `▸ 已思考 · N 项`（N = 有数据的分类数），流式中显示 `思考中…` 并实时展开当前推理文本
- 展开态：**动态分组列表**（不是固定 Tab）——只渲染实际有数据的分类，按 推理 → 工具调用 → 知识检索 → 记忆引用 的顺序堆叠标题+内容，没有数据的分类直接不出现
- 各分类内容渲染逻辑复用现有实现细节（工具调用 chip 的"经发现"标记、知识检索的置信度/回退说明、记忆引用的场景数/事实数），只是改变了外层容器结构和视觉样式（去卡片背景，统一为轻量文本层级）

`ModelRunTrace.jsx` 的渲染逻辑迁移进新的 `ThinkingTrace.jsx`，原文件废弃；`MessageBubble.jsx` 里 `message.thoughts` 独立渲染块与 `<ModelRunTrace>` 调用合并为一次 `<ThinkingTrace>` 调用。

### 3. 回答正文（RichAiMessage.jsx）

`RichAiMessage` 本身没有气泡背景，Section 1 移除外层容器后自然呈现无边框效果，无需结构改动。视觉打磨：
- 代码块 `.ai-code-block`：保留深色卡片背景不变（代码块需要与正文有明确边界，这是唯一在"正文渲染"层级保留背景色的例外）
- 表格 `.ai-md-table-wrap`：去除白底卡片边框/阴影，改为只保留表头下方一条分隔线的极简表格
- 标题/列表/加粗：字号字重随整体排版系统微调，结构不变

### 4. 确认卡片（InteractiveFormCard.jsx）

**原则：表单类可交互组件保留边界，不强行无容器**（区别于纯展示文本的"全面去容器"基调）——避免用户分不清"文本"与"可操作控件"。

- `.ai-form-card` 现有渐变背景 + 明显描边 → 改为无背景、只保留 1px 极浅边框（`border border-line`）
- 标题/说明文字/输入框/提交按钮排版与交互逻辑不变

### 5. 建议操作（suggestedActions + DraftLinker.jsx）

沿用同一"保留边界"原则。发现 `DraftLinker` 已有 `action.primary` 字段区分主次操作，`suggestedActions` 与 `DraftLinker` 统一视觉语言：
- 主操作用 `.btn-pri`（实心），次要操作用 `.btn-out`（描边）
- 只做圆角/间距/字号的一致化微调，不改结构
- 承担 beautifui "追问建议（Follow-ups）"的功能定位，不单独新建组件

### 6. 底部输入框（Composer.jsx）

**仅做视觉打磨，功能不变**：
- 附件按钮、发送按钮图标/间距/圆角视觉一致化
- 输入框边框/聚焦态改得更轻量
- "AI 正在回复…"状态行排版对齐整体极简风格

不新增 @ 提及数据源 / 斜杠命令 / 模型选择器 / 语音听写。

### 7. 后台任务面板（index.jsx 顶部任务徽标）

现有"后台任务 进行中 X · 已完成 Y"折叠文字 + 单条"执行中"横条，改造为**逐条任务行列表**：

- 数据源：`backgroundRuns.runs`（现有数组，无需新增后端字段）
- 每行：状态点（进行中=脉冲蓝点 / 已完成=绿勾 / 失败=红叉，复用现有 `.bdg` 徽标色板）+ 标题 + 该行专属"停止"按钮（仅进行中显示）
- 折叠态默认只显示前 1-2 条 + "还有 N 项"，点击展开全部
- 无卡片背景，行与行之间只用分隔线区分
- 不做子步骤嵌套展开（无对应数据）

### 8. 附件卡片（AttachmentCard.jsx）

改动最小：
- 边框/背景色统一为 Section 4/5 一致的极简描边风格，去除现有 `boxShadow`
- 图标块/文件名/元信息字号间距对齐整体排版系统
- 交互逻辑（移除按钮、compact/inverted 变体）不变

## 技术实现约定

- 所有改造组件使用 Tailwind utility class 编写（延续 `LoadingState.jsx` 的 Phase 1 验证经验），复用 `tailwind.css` 里已桥接的语义化类名（`bg-ink`/`text-ink-3`/`border-line` 等）
- 不引入 Tailwind preflight，不影响未改造的其他页面
- `ModelRunTrace.jsx` 废弃，逻辑迁移至新建的 `ThinkingTrace.jsx`；其余改造在原文件内进行，不新建冗余文件

## 测试策略

- 现有 vitest 用例（`message-meta-bar.test.jsx`、`streaming-ux.test.jsx`、`session-isolation.test.jsx`、`HomeWorkspace.test.jsx` 等）覆盖了消息渲染的行为断言（loading 占位文案、思考折叠交互、meta 栏显隐），改造后需保证全部通过，必要时更新断言中依赖旧 DOM 结构（如 `.ai-bubble-wrap`/`.ai-avatar`）的选择器
- 新增 `ThinkingTrace.jsx` 的动态分组逻辑需要新增单元测试：验证"只有部分分类有数据时空分类不渲染"这一关键行为
- 浏览器视觉核对：至少覆盖 assistant 纯文本回复、user 消息、error 消息、loading 态、思考轨迹展开态、表单确认卡片、后台任务列表展开态 7 种状态截图

## 风险与回滚

- 纯前端改动，不涉及数据契约，回滚成本低（还原组件文件即可）
- 主要风险是现有 vitest 用例里依赖旧 CSS 类名/DOM 结构的断言可能失败，需要在实现阶段同步更新测试选择器，而非删除断言
