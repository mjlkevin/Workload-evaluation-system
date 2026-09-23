# AI 工作台前端迭代 · 技术交接文档

- 交付日期：2026-09-13
- 原型文件：`ai-workbench-replica.html`（单文件、自包含，浏览器直接打开即可验收）
- 设计系统：WES Workbench（Datum）—— indigo 品牌色 / 蓝灰画布 / mono 微标签
- 对接目标：`ui/V2_PROTOTYPE`（Vite + React），AiHomeWorkbench 相关组件
- 本文用途：供开发按项接收、匹配实现；原型内 class 为视觉与交互的唯一事实源

---

## 0. 本轮优化目标

对 AI 工作台（AiHomeWorkbench）做一轮「视觉质感 + 状态语义」收口，共 4 项：

1. 聊天面板边距收紧 —— 消息内容吃满更多宽度
2. 消息发送区（composer）打磨 —— 尺寸对齐、焦点态补全
3. AI 回复补 agent 身份标识 —— 头像 + 名称
4. 失败会话「未读才脉冲、已读静态红」—— 状态语义

## 1. 优化项总览

| # | 优化项 | 原型内 class | 建议落点（React） | 优先级 |
|---|--------|--------------|------------------|--------|
| 1 | 聊天面板边距收紧 | `.chat__head` `.chat__body` `.chat__foot` | ChatArea 容器 / 布局 | P0 |
| 2 | 发送区打磨 | `.composer` `.wf-btn` `.composer__send` 等 | `components/ChatArea/Composer.jsx` | P0 |
| 3 | AI 消息身份标识 | `.msg-agent` `.msg-agent__av` `.msg-agent__name` | `components/ChatArea/MessageBubble.jsx` | P1 |
| 4 | 失败会话未读/已读脉冲 | `.session-item.is-read` `.session-unread` | 会话 / 历史列表组件 | P0 |

## 2. 逐项说明

### 2.1 聊天面板边距收紧

目标：横向 padding 从 20/28px 统一收为 16px，消息内容更宽、更贴边。

| 选择器 | 变更前 | 变更后 |
|--------|--------|--------|
| `.chat__head` | `padding:12px 20px` | `padding:10px 16px` |
| `.chat__body` | `padding:24px 28px` | `padding:16px 16px` |
| `.chat__foot` | `padding:14px 20px 18px` | `padding:12px 16px 14px` |

要点：三处横向统一为 16px，垂直同步收紧。移动端 `@media(max-width:760px)` 下 `.chat__body{padding:16px}` 已与桌面一致，无需额外处理。

### 2.2 消息发送区（composer）打磨

目标：控件尺寸对齐 `--control-height(36px)`，补全焦点 / 展开状态。

- `.composer`：padding `14px 14px 10px` → `12px 12px 10px`；`:focus-within` 增一圈淡品牌光环 `box-shadow:0 0 0 3px oklch(.42 .14 262/.14)`
- `.wf-btn`（工作流选择器）：由透明文字按钮改为 **28px 描边 chip**（`border:1px solid var(--line); background:var(--surface)`）；hover 加深描边、focus 显焦点环、展开（`.wf-dd.open`）变品牌色底
- `.composer__attach`（附件）：32 → 36px，拆分 hover/focus，focus 显焦点环
- `.composer__send`（发送）：32 → 36px，加品牌色投影 `0 6px 16px -8px var(--brand)`、focus 焦点环、按压缩放 `.94`
- `.composer__ta`（输入框）：顶部内边距 6 → 8px，与加高后的按钮对齐
- `.composer__hint`：前置 6px 品牌圆点（`::before`），作为「当前选中模板」状态指示
- `.composer__run`：margin-top 10 → 8px

### 2.3 AI 消息身份标识

目标：AI 回复带清晰 agent 归属（Qoder 风格），与用户消息一眼区分。

- 新增 class：
  - `.msg-agent`：行容器（`display:flex; align-items:center; gap:6px; padding:0 4px`）
  - `.msg-agent__av`：20px 品牌色「D」头像（`background:var(--brand)`、`color:var(--surface)`、`border-radius:var(--r-sm)`、mono 字体）
  - `.msg-agent__name`：mono 微字（`font-size:11.5px; color:var(--ink-3); letter-spacing:.02em`），如「Datum 助手」
- 结构：AI 消息气泡上方插入
  `<div class="msg-agent"><span class="msg-agent__av">D</span><span class="msg-agent__name">Datum 助手</span></div>`
- **务必同步动态渲染**：`appendAi()`（发送后追加 AI 回复）也带上同一结构，避免「首屏有、追加后无」的不一致。

### 2.4 失败会话「未读 / 已读」脉冲

目标：失败只有「未读」时才用脉冲抢注意力，读过后安静为静态红。

- 未读态：红色圆点用 `pulse-failed` 关键帧脉冲（0.7s、缩放更强），并显示红色 mono「未读」徽标（`.session-badge.failed.session-unread`）
- 已读态：给会话项加 `.is-read` 后——
  - `.session-item.is-read .session-item__dot.failed{animation:none}`（停脉冲，保持静态红）
  - `.session-item.is-read .session-unread{display:none}`（隐徽标）
- 交互（JS）：点击会话项 = 选中（切 `.on`）+ 标记已读（加 `.is-read`）

## 3. 交互 / 状态逻辑（原型 JS，需等价实现）

1. **会话点击**：选中当前会话 + 标记已读（失败会话据此停脉冲、隐「未读」徽标）
2. **composer 状态**：输入非空才可发送；回车发送 / Shift+Enter 换行；工作流下拉 hover/click 展开、选中注入 prompt；发送后走「生成中 → 追加 AI 回复」流程
3. **附件 / 发送 / 工作流**：均有 hover / focus-visible / disabled 三态

## 4. 实现约束（务必遵守）

- 沿用 WES Workbench token（`--brand` / `--ink-*` / `--line` / `--r-*` / `--shadow-focus`），**不引入新配色、不写裸色值**
- 状态徽标 / 圆点一律「soft-fill 底 + 饱和 ink 文字 + 圆点」；失败用红、运行用品牌色、成功用绿，语义色不与 warning 混用
- 焦点态统一用 `--shadow-focus` 环，不出现「裸 `outline:none` 且无替代焦点」
- 不得改动：侧栏 / 主导航、右侧工作区（inspector）结构、设计 token 定义

## 5. 交付物清单

- `ai-workbench-replica.html` —— 本轮优化后的原型（可直接浏览器打开验收）
- `AI工作台-前端迭代技术文档.md` —— 本文档
