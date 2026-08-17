# AI 工作台对话界面现代化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去除 AI 工作台对话消息的头像与气泡容器，把分散的思考轨迹/工具调用/知识检索/记忆引用整合为一个统一披露组件，并对确认卡片、建议操作、输入框、后台任务面板、附件卡片做一致的极简化视觉打磨。

**Architecture:** 纯前端改造，不触碰后端契约。核心是新建 `ThinkingTrace.jsx` 替代 `ModelRunTrace.jsx` + `MessageBubble.jsx` 内联的 thoughts 块；新建 `BackgroundRunsPanel.jsx` 把后台任务从"一行文字徽标+单条停止横条"改造成逐行任务列表。其余组件（`InteractiveFormCard`/`DraftLinker`/`Composer`/`AttachmentCard`）做原地视觉打磨，不改变对外接口。

**Tech Stack:** React 18 + Vite 5，样式使用 Tailwind v4 utility class（`src/tailwind.css` 已桥接 OKLCH 设计变量），测试用 Vitest + Testing Library。

**依据设计文档：** `docs/superpowers/specs/2026-08-17-ai-workbench-message-ui-modernization-design.md`

---

## 关键实现决策（避免后续任务出现矛盾）

1. **`.ai-bubble-wrap` 类名保留，只清空视觉样式**——不删除这个 DOM 结构/类名，只是把 `padding`/`border`/`background`/`box-shadow` 从 CSS 规则里移除。这样 `message-meta-bar.test.jsx` 里 `container.querySelector('.ai-bubble-wrap')` 的断言不需要改动，容器结构不变，只是不再有视觉边界。
2. **`ThinkingTrace` 不是一个"外层再包一层折叠"的组件**——它是把原来分散在气泡两处（thoughts 内联块 + `<ModelRunTrace>`）的四类数据合并到*同一个文件、同一次渲染调用*里，按 推理→工具调用→知识检索→记忆引用 顺序堆叠。每一类的展开/折叠行为保持各自独立（工具调用有自己的展开按钮，知识检索/记忆引用一直可见不折叠），不新增一个包裹全部四类的外层开关。这保证 `chip-live-link.test.jsx`（通过 `MessageBubble` 间接测试）无需任何改动即可通过。
3. **后台任务改造范围**：只把"当前会话执行中"的单条停止横条，换成 `backgroundRuns.runs` 里所有处于活跃状态（`queued`/`running`/`recovering`/`waiting`）的任务的逐行列表；顶部"进行中 X · 已完成 Y"计数徽标的数据源（`workbench.unifiedView.runs`）和计算逻辑保持不变，只是和任务行列表合并进同一个视觉容器。

---

## 文件结构

- **新建** `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/ThinkingTrace.jsx` —— 统一思考轨迹组件
- **新建** `ui/V2_PROTOTYPE/src/__tests__/thinking-trace.test.jsx` —— `ThinkingTrace` 专属单元测试
- **删除** `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/StatusPanel/ModelRunTrace.jsx`
- **修改** `ui/V2_PROTOTYPE/src/__tests__/memory-visibility.test.jsx` —— 改为测试 `ThinkingTrace`
- **修改** `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx` —— 接入 `ThinkingTrace`，去头像/气泡，错误态、meta 栏对齐、建议操作按钮样式
- **修改** `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/WorkspacePanel/DraftLinker.jsx` —— 视觉一致化（无结构改动）
- **修改** `ui/V2_PROTOTYPE/src/components/AiWorkbench/InteractiveFormCard.jsx` —— 边框改极简
- **修改** `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/Composer.jsx` —— 视觉打磨
- **新建** `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/BackgroundRunsPanel.jsx` —— 后台任务逐行列表
- **修改** `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/index.jsx` —— 接入 `BackgroundRunsPanel`
- **修改** `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/AttachmentCard.jsx` —— 视觉打磨
- **修改** `ui/V2_PROTOTYPE/src/index.css` —— 清理上述改造涉及的旧 CSS 规则

---

### Task 1: 新建 ThinkingTrace 组件（TDD）

**Files:**
- Create: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/ThinkingTrace.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/thinking-trace.test.jsx`

- [ ] **Step 1: 写失败测试**

创建 `ui/V2_PROTOTYPE/src/__tests__/thinking-trace.test.jsx`：

```jsx
import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ThinkingTrace from '../pages/AiHomeWorkbench/components/ChatArea/ThinkingTrace.jsx'

const knowledgeToolFixture = {
  toolId: 'knowledge_base.query_product_knowledge',
  available: true,
  retrievalTriggered: true,
  confidence: 'high',
  model: 'glm-4.6',
  fallbackReason: '',
  contextRef: 'ctx-1',
}

describe('ThinkingTrace', () => {
  test('四类数据都没有时不渲染任何内容', () => {
    const { container } = render(<ThinkingTrace messageId="m0" />)
    expect(container).toBeEmptyDOMElement()
  })

  test('只有 thoughts 时渲染折叠态摘要，点击展开显示推理文本', () => {
    const onToggleThought = vi.fn()
    render(
      <ThinkingTrace
        messageId="m1"
        thoughts={[{ text: '正在分析需求边界', collapsed: true }]}
        streaming={false}
        onToggleThought={onToggleThought}
      />,
    )
    expect(screen.getByText('已思考')).toBeInTheDocument()
    expect(screen.queryByText('正在分析需求边界')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('已思考'))
    expect(onToggleThought).toHaveBeenCalledWith('m1', 0)
  })

  test('streaming 为 true 且未折叠时显示"思考中…"', () => {
    render(
      <ThinkingTrace
        messageId="m2"
        thoughts={[{ text: '推理中的文本', collapsed: false }]}
        streaming={true}
      />,
    )
    expect(screen.getByText('思考中…')).toBeInTheDocument()
    expect(screen.getByText('推理中的文本')).toBeInTheDocument()
  })

  test('既有知识库 chip 行为保持不变', () => {
    render(<ThinkingTrace messageId="m3" knowledgeTool={knowledgeToolFixture} />)
    expect(screen.getByLabelText('知识库参考')).toBeInTheDocument()
    expect(screen.getByText('知识库参考')).toBeInTheDocument()
    expect(screen.queryByLabelText('工具调用')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('引用记忆')).not.toBeInTheDocument()
  })

  test('工具调用 chip：默认折叠，展开可见工具名', () => {
    render(
      <ThinkingTrace
        messageId="m4"
        knowledgeTool={knowledgeToolFixture}
        toolCalls={[
          { name: 'knowledge_query', source: 'list_tools' },
          { name: 'project_list', source: 'list_tools' },
        ]}
      />,
    )
    const chip = screen.getByLabelText('工具调用')
    expect(chip).toBeInTheDocument()
    expect(screen.queryByText('knowledge_query')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /工具调用/ }))
    expect(screen.getByText('knowledge_query')).toBeInTheDocument()
    expect(screen.getByText('project_list')).toBeInTheDocument()
  })

  test('仅有工具调用数据时也应渲染 chip', () => {
    render(<ThinkingTrace messageId="m5" toolCalls={[{ name: 'estimate_history', source: 'list_tools' }]} />)
    expect(screen.getByLabelText('工具调用')).toBeInTheDocument()
    expect(screen.queryByLabelText('知识库参考')).not.toBeInTheDocument()
  })

  test('引用记忆标记：数量大于 0 才渲染', () => {
    const { rerender } = render(
      <ThinkingTrace messageId="m6" memoryRef={{ scenesCount: 2, atomsCount: 3 }} />,
    )
    const marker = screen.getByLabelText('引用记忆')
    expect(marker).toHaveTextContent('2 场景')
    expect(marker).toHaveTextContent('3 事实')

    rerender(<ThinkingTrace messageId="m7" memoryRef={{ scenesCount: 0, atomsCount: 0 }} />)
    expect(screen.queryByLabelText('引用记忆')).not.toBeInTheDocument()
  })

  test('四类数据同时存在时按 推理→工具调用→知识检索→记忆引用 顺序渲染', () => {
    const { container } = render(
      <ThinkingTrace
        messageId="m8"
        thoughts={[{ text: '推理文本', collapsed: true }]}
        toolCalls={[{ name: 'estimate_history', source: 'list_tools' }]}
        knowledgeTool={knowledgeToolFixture}
        memoryRef={{ scenesCount: 1, atomsCount: 1 }}
      />,
    )
    const labels = Array.from(container.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label'))
    expect(labels).toEqual(['知识库参考', '工具调用', '引用记忆'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ui/V2_PROTOTYPE && npx vitest run src/__tests__/thinking-trace.test.jsx`
Expected: FAIL，报错 `Failed to resolve import "../pages/AiHomeWorkbench/components/ChatArea/ThinkingTrace.jsx"`

- [ ] **Step 3: 实现 ThinkingTrace.jsx**

创建 `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/ThinkingTrace.jsx`：

```jsx
import { useState } from 'react'

/**
 * 统一的模型「思考轨迹」披露区：合并推理文本、工具调用、知识检索、
 * 记忆引用四类数据到一次渲染，取代原来分散在气泡内两个位置的
 * thoughts 内联块 + <ModelRunTrace>。四类数据独立存在与否互不影响，
 * 只渲染实际有数据的分类，固定顺序：推理 → 工具调用 → 知识检索 → 记忆引用。
 * 各分类的展开/折叠行为保持互相独立，不套一个包裹全部的外层开关。
 */
export default function ThinkingTrace({
  messageId,
  thoughts,
  streaming,
  onToggleThought,
  knowledgeTool,
  toolCalls,
  memoryRef,
}) {
  const [toolsExpanded, setToolsExpanded] = useState(false)

  const thoughtList = Array.isArray(thoughts) ? thoughts : []
  const hasThoughts = thoughtList.length > 0
  const hasKnowledge = Boolean(knowledgeTool)
  const toolCallList = Array.isArray(toolCalls) ? toolCalls.filter((t) => t && t.name) : []
  const hasToolCalls = toolCallList.length > 0
  const scenesCount = Number(memoryRef?.scenesCount) || 0
  const atomsCount = Number(memoryRef?.atomsCount) || 0
  const hasMemoryRef = scenesCount > 0 || atomsCount > 0

  if (!hasThoughts && !hasKnowledge && !hasToolCalls && !hasMemoryRef) return null

  return (
    <div className="mb-2.5 flex flex-col gap-1.5">
      {hasThoughts && thoughtList.map((thought, idx) => (
        <div key={`thought-${idx}`}>
          <button
            type="button"
            onClick={() => onToggleThought?.(messageId, idx)}
            className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-xs text-ink-3"
          >
            <span>{thought.collapsed ? '▶' : '▼'}</span>
            <span>{thought.collapsed ? '已思考' : (streaming ? '思考中…' : '思考过程')}</span>
          </button>
          {!thought.collapsed && (
            <div className="mt-1 whitespace-pre-wrap rounded-md bg-accent-soft px-2.5 py-2 text-xs leading-relaxed text-ink-2">
              {thought.text}
            </div>
          )}
        </div>
      ))}
      {hasKnowledge && <KnowledgeTraceChip knowledgeTool={knowledgeTool} />}
      {hasToolCalls && (
        <div aria-label="工具调用" className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
          <button
            type="button"
            onClick={() => setToolsExpanded((v) => !v)}
            aria-expanded={toolsExpanded}
            className="inline-flex min-h-[22px] cursor-pointer items-center gap-1 rounded-md border border-brand/30 bg-brand-soft px-1.5 py-0.5 text-[11px] font-bold text-brand"
          >
            <span aria-hidden="true">{toolsExpanded ? '▾' : '▸'}</span>
            工具调用 {toolCallList.length} 项
          </button>
          {toolsExpanded && toolCallList.map((call, idx) => (
            <span key={`${call.name}-${idx}`}>
              <code className="border-0 bg-transparent p-0">{call.name}</code>
              {call.source === 'list_tools' && <em className="not-italic text-ink-3">· 经发现</em>}
            </span>
          ))}
        </div>
      )}
      {hasMemoryRef && (
        <div aria-label="引用记忆" className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
          <span>引用记忆</span>
          {scenesCount > 0 && <span>{scenesCount} 场景</span>}
          {atomsCount > 0 && <span>{atomsCount} 事实</span>}
        </div>
      )}
    </div>
  )
}

/** 既有知识库检索 chip（渲染逻辑与既有 ModelRunTrace 保持一致） */
function KnowledgeTraceChip({ knowledgeTool }) {
  const confidenceLabel = knowledgeTool.confidence === 'high' ? '高置信' : '低置信'
  const retrievalLabel = `retrievalTriggered=${knowledgeTool.retrievalTriggered ? 'true' : 'false'}`
  const isRealRetrieval = knowledgeTool.available && knowledgeTool.retrievalTriggered && knowledgeTool.confidence === 'high'
  const isUnavailable = !knowledgeTool.available
  const hasFallback = Boolean(knowledgeTool.fallbackReason)
  return (
    <div aria-label="知识库参考" className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
      <span>{isRealRetrieval ? '知识库参考' : '模型通用知识'}</span>
      {knowledgeTool.model && <code className="border-0 bg-transparent p-0">{knowledgeTool.model}</code>}
      <span>{retrievalLabel}</span>
      <span>{confidenceLabel}</span>
      {knowledgeTool.fallbackReason && <span>{knowledgeTool.fallbackReason}</span>}
      {isUnavailable && <span className="text-warn">知识库未配置</span>}
      {hasFallback && !isUnavailable && <span className="text-warn">检索未命中</span>}
    </div>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd ui/V2_PROTOTYPE && npx vitest run src/__tests__/thinking-trace.test.jsx`
Expected: PASS，8 个测试全绿

- [ ] **Step 5: 提交**

```bash
cd /Users/kevin/AI/Workload-evaluation-system
git add ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/ThinkingTrace.jsx ui/V2_PROTOTYPE/src/__tests__/thinking-trace.test.jsx
git commit -m "feat(V2_PROTOTYPE): 新建 ThinkingTrace 统一思考轨迹组件"
```

---

### Task 2: 迁移 memory-visibility 测试到 ThinkingTrace（删除 ModelRunTrace 挪到 Task 3）

> **2026-08-17 计划修正**：原计划在本任务里删除 `ModelRunTrace.jsx`，但它此时仍被 `MessageBubble.jsx` 实际引用（Task 3 才会把 `MessageBubble.jsx` 改成引用 `ThinkingTrace`）。`memory-visibility.test.jsx` 自身又通过 `ChatArea/index.jsx` 间接加载 `MessageBubble.jsx`，如果这里先删除 `ModelRunTrace.jsx`，整个测试文件（包括本任务不该动的"待确认记忆提示条"那个 describe 块）会因为模块解析失败而直接挂掉。因此删除动作改为在 **Task 3** 完成 `MessageBubble.jsx` 改造之后再做（Task 3 已相应补充 Step 6）。本任务只做测试迁移，不删文件。

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/__tests__/memory-visibility.test.jsx:11,165-228`

- [ ] **Step 1: 修改 memory-visibility.test.jsx 的 import 与渲染调用**

把第 11 行：
```js
import ModelRunTrace from '../pages/AiHomeWorkbench/components/StatusPanel/ModelRunTrace.jsx'
```
改为：
```js
import ThinkingTrace from '../pages/AiHomeWorkbench/components/ChatArea/ThinkingTrace.jsx'
```

把第 165-228 行整个 `describe('ModelRunTrace 通用 chip...')` 块替换为：

```jsx
describe('ThinkingTrace 通用 chip（MS3 工具发现 + MS2-PATCH 引用记忆）', () => {
  it('既有知识库 chip 行为保持不变', () => {
    render(<ThinkingTrace messageId="t1" knowledgeTool={knowledgeToolFixture} />)

    expect(screen.getByLabelText('知识库参考')).toBeInTheDocument()
    expect(screen.getByText('知识库参考')).toBeInTheDocument()
    expect(screen.queryByLabelText('工具调用')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('引用记忆')).not.toBeInTheDocument()
  })

  it('工具发现 trace chip：默认折叠，展开可见经 list_tools 选中的工具', () => {
    render(
      <ThinkingTrace
        messageId="t2"
        knowledgeTool={knowledgeToolFixture}
        toolCalls={[
          { name: 'knowledge_query', source: 'list_tools' },
          { name: 'project_list', source: 'list_tools' },
        ]}
      />,
    )

    const chip = screen.getByLabelText('工具调用')
    expect(chip).toBeInTheDocument()
    expect(screen.queryByText('knowledge_query')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /工具调用/ }))
    expect(screen.getByText('knowledge_query')).toBeInTheDocument()
    expect(screen.getByText('project_list')).toBeInTheDocument()
  })

  it('仅有工具调用数据（无知识库 trace）时也应渲染 chip', () => {
    render(<ThinkingTrace messageId="t3" toolCalls={[{ name: 'estimate_history', source: 'list_tools' }]} />)

    expect(screen.getByLabelText('工具调用')).toBeInTheDocument()
    expect(screen.queryByLabelText('知识库参考')).not.toBeInTheDocument()
  })

  it('引用记忆标记：与工具调用 chip 统一设计语言', () => {
    render(
      <ThinkingTrace
        messageId="t4"
        knowledgeTool={knowledgeToolFixture}
        memoryRef={{ scenesCount: 2, atomsCount: 3 }}
      />,
    )

    const marker = screen.getByLabelText('引用记忆')
    expect(marker).toBeInTheDocument()
    expect(marker).toHaveTextContent('引用记忆')
    expect(marker).toHaveTextContent('2 场景')
    expect(marker).toHaveTextContent('3 事实')
  })

  it('引用记忆计数为 0 时不渲染标记', () => {
    render(
      <ThinkingTrace
        messageId="t5"
        knowledgeTool={knowledgeToolFixture}
        memoryRef={{ scenesCount: 0, atomsCount: 0 }}
      />,
    )

    expect(screen.queryByLabelText('引用记忆')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认通过**

Run: `cd ui/V2_PROTOTYPE && npx vitest run src/__tests__/memory-visibility.test.jsx`
Expected: PASS，全部用例通过（包括 Step 1 未改动的"待确认记忆提示条"部分）。此时 `ModelRunTrace.jsx` 仍然存在于磁盘上且仍被 `MessageBubble.jsx` 引用，不要删除它——删除动作已挪到 Task 3。

- [ ] **Step 3: 提交（只提交测试迁移，不动 ModelRunTrace.jsx）**

```bash
cd /Users/kevin/AI/Workload-evaluation-system/.claude/worktrees/feat+ai-workbench-ui-modernization
git add ui/V2_PROTOTYPE/src/__tests__/memory-visibility.test.jsx
git commit -m "refactor(V2_PROTOTYPE): 迁移 memory-visibility 测试到 ThinkingTrace（ModelRunTrace 删除挪至 Task 3）"
```

---

### Task 3: 在 MessageBubble 接入 ThinkingTrace，去头像/气泡，重做错误态与 meta 栏

> **2026-08-17 计划修正**：本任务新增 Step 6——`MessageBubble.jsx` 改为引用 `ThinkingTrace` 后，`ModelRunTrace.jsx` 才真正没有生产代码引用它，这时才能安全删除（原本安排在 Task 2 删除，但 Task 2 执行时发现 `memory-visibility.test.jsx` 通过 `ChatArea/index.jsx` 间接加载 `MessageBubble.jsx`，过早删除会导致模块解析失败、整个测试文件挂掉，已改为在此处删除）。

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx`
- Delete: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/StatusPanel/ModelRunTrace.jsx`（本任务 Step 6，不在 Task 2 做）

- [ ] **Step 1: 运行既有测试确认当前基线全绿（作为改动前后对照基准）**

Run: `cd ui/V2_PROTOTYPE && npx vitest run src/__tests__/message-meta-bar.test.jsx src/__tests__/chip-live-link.test.jsx`
Expected: PASS（4 + 3 个用例）

- [ ] **Step 2: 重写 MessageBubble.jsx**

把整个文件替换为：

```jsx
import InteractiveFormCard from '../../../../components/AiWorkbench/InteractiveFormCard.jsx'
import { pickArray } from '../../utils/harnessPayload.js'
import ThinkingTrace from './ThinkingTrace.jsx'
import ReportViewer from '../WorkspacePanel/ReportViewer.jsx'
import DraftLinker from '../WorkspacePanel/DraftLinker.jsx'
import AttachmentCard from './AttachmentCard.jsx'
import RichAiMessage from './RichAiMessage.jsx'
import LoadingState from './LoadingState.jsx'
import { CopyMessageButton, MessageTimestamp } from './MessageBits.jsx'

export default function MessageBubble({
  message,
  index,
  sending,
  confirmingActionId,
  onOptionSelect,
  onFormSubmit,
  onHarnessAction,
  onStructuredSupplement,
  onSuggestedAction,
  goLogin,
  copyDraft,
  onToggleThought,
}) {
  const isUser = message.role === 'user'
  const hasArtifacts = !isUser && !message.error && pickArray(message.artifacts).length > 0
  // RP-056：复制控件 + 时间戳移出气泡，置于文本下方，跟随角色对齐方向（悬浮消息行显隐）
  const showMetaBar = !message.loading && !message.error && Boolean(message.text)
  const metaAlign = isUser ? 'justify-end' : 'justify-start'
  return (
    <article className="ai-msg-row" style={{ display: 'flex', gap: 10, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div className="ai-msg-col" style={{ width: hasArtifacts ? 'min(100%, 1080px)' : undefined, maxWidth: hasArtifacts ? '100%' : (isUser ? '70%' : '76%') }}>
      <div
        className={`ai-bubble-wrap ${isUser ? 'text-right font-medium' : 'text-left font-normal'}${message.error ? ' border-l-2 border-err pl-2.5' : ''}`}
        style={{ position: 'relative' }}
      >
        {/* ISS-2026-08-10-005：思考轨迹移到回答正文上方（对标业内：思考在上、回答在下）；
            2026-08-17 起合并进统一的 ThinkingTrace（原 thoughts 内联块 + ModelRunTrace）。 */}
        {!isUser && !message.error && (
          <ThinkingTrace
            messageId={message.id}
            thoughts={message.thoughts}
            streaming={message.streaming}
            onToggleThought={onToggleThought}
            knowledgeTool={message.knowledgeTool}
            toolCalls={message.toolCalls}
            memoryRef={message.memoryRef}
          />
        )}
        {message.loading ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.7 }}>{message.text}</div>
            <div style={{ marginTop: 6 }}>
              <LoadingState />
            </div>
          </div>
        ) : (
          isUser || message.error
            ? <div style={{ fontSize: 13, lineHeight: 1.7 }}>{message.text}</div>
            : <RichAiMessage text={message.text} optionDisabled={sending} onOptionSelect={onOptionSelect} />
        )}
        {!isUser && !message.error && message.formBlock && (
          <InteractiveFormCard
            formBlock={message.formBlock}
            disabled={sending}
            onSubmit={onFormSubmit}
          />
        )}
        {!isUser && !message.error && pickArray(message.artifacts).map((artifact) => (
          <ReportViewer
            key={artifact.harnessArtifactId || artifact.artifactId || artifact.title}
            artifact={artifact}
            onAction={onHarnessAction}
            onSubmitSupplement={onStructuredSupplement}
            confirmingActionId={confirmingActionId}
          />
        ))}
        {!isUser && !message.error && pickArray(message.suggestedActions).length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {message.suggestedActions.map((action) => {
              const actionKey = action.id || action.actionId || action.actionType
              const isConfirmingSuggestedAction = confirmingActionId === actionKey
              return (
                <button
                  key={actionKey}
                  className={action.primary ? 'btn btn-pri' : 'btn btn-out'}
                  type="button"
                  disabled={action.disabled || isConfirmingSuggestedAction}
                  onClick={() => onSuggestedAction?.(action, actionKey)}
                  style={{ height: 30 }}
                >
                  {isConfirmingSuggestedAction ? '执行中…' : action.label}
                </button>
              )
            })}
          </div>
        )}
        {!isUser && !message.error && message.actions && (
          <DraftLinker actions={message.actions} />
        )}
        {message.file && <div style={{ marginTop: 10 }}><AttachmentCard file={message.file} state="sent" compact inverted={isUser} /></div>}
        {message.action === 'login_required' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button className="btn btn-pri" type="button" onClick={goLogin} style={{ height: 30 }}>重新登录</button>
            <button className="btn btn-out" type="button" onClick={copyDraft} style={{ height: 30 }}>复制草稿</button>
          </div>
        )}
      </div>
      {showMetaBar && (
        <div className={`ai-msg-meta flex ${metaAlign}`}>
          <CopyMessageButton text={message.text} />
          <MessageTimestamp createdAt={message.createdAt} />
        </div>
      )}
      </div>
    </article>
  )
}
```

关键变化说明：
- 删除了两个 `.ai-avatar` div（AI/我头像）
- `.ai-bubble-wrap` 类名保留（供既有测试选择器使用），但不再传入 `padding`/`borderRadius` 等 inline style；用 Tailwind 的 `text-right font-medium`（user）/ `text-left font-normal`（assistant）区分角色，`message.error` 时加 `border-l-2 border-err pl-2.5` 左侧竖线
- 原来的 `ai-avatar--bot` 判断逻辑消失，`hasArtifacts` 时的 `maxWidth` 从 `calc(100% - 44px)` 改为 `100%`（不再需要给头像让位）；非 artifacts 消息按角色区分：user 从 `76%` 收紧到 `70%`（设计文档明确要求，避免长消息占满一行），assistant 纯文本回复维持原有 `76%` 不变（设计文档未要求收紧，保留现状避免引入未批准的行为变化）
- `message.thoughts` 内联块与 `<ModelRunTrace>` 调用替换为一次 `<ThinkingTrace>` 调用
- `.ai-msg-meta` 新增 `flex ${metaAlign}` class，让复制按钮+时间戳跟随消息角色左右对齐
- `suggestedActions` 按钮组新增 `action.primary` 判断（`btn-pri`/`btn-out`），与 `DraftLinker` 统一视觉语言

- [ ] **Step 3: 运行测试确认通过**

Run: `cd ui/V2_PROTOTYPE && npx vitest run src/__tests__/message-meta-bar.test.jsx src/__tests__/chip-live-link.test.jsx`
Expected: PASS，全部 7 个用例通过，无需修改测试文件本身

- [ ] **Step 4: 运行 HomeWorkspace 与 streaming-ux 全量回归**

Run: `cd ui/V2_PROTOTYPE && npx vitest run src/__tests__/HomeWorkspace.test.jsx src/__tests__/streaming-ux.test.jsx src/__tests__/session-isolation.test.jsx src/__tests__/unified-view.test.jsx src/__tests__/run-submit.test.jsx`
Expected: PASS 全部通过。如果有断言依赖 `.ai-avatar` 或旧的 `ai-msg-meta` 结构失败（目前排查确认没有），在这一步定位并修复对应测试文件的选择器，不得删除断言。

- [ ] **Step 5: 提交**

```bash
cd /Users/kevin/AI/Workload-evaluation-system/.claude/worktrees/feat+ai-workbench-ui-modernization
git add ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx
git commit -m "feat(V2_PROTOTYPE): MessageBubble 去头像/气泡，接入 ThinkingTrace，错误态改左侧竖线"
```

- [ ] **Step 6: 删除 ModelRunTrace.jsx（挪自 Task 2）**

此时 `MessageBubble.jsx` 已经不再引用 `ModelRunTrace`，是它在生产代码里的唯一调用方。先确认没有任何文件还在引用：

Run: `cd ui/V2_PROTOTYPE && grep -rln "ModelRunTrace" src`
Expected: 无输出

确认无输出后执行：

```bash
cd /Users/kevin/AI/Workload-evaluation-system/.claude/worktrees/feat+ai-workbench-ui-modernization
git rm ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/StatusPanel/ModelRunTrace.jsx
git commit -m "refactor(V2_PROTOTYPE): 删除 ModelRunTrace（已被 ThinkingTrace 完全取代）"
```

再跑一次 Task 2 迁移过的测试，确认它现在也能完整通过（此前 Task 2 阶段这个文件因为 `ModelRunTrace.jsx` 还在被引用而无法在删除后验证）：

Run: `cd ui/V2_PROTOTYPE && npx vitest run src/__tests__/memory-visibility.test.jsx`
Expected: PASS，全部用例通过

---

### Task 4: 清理 index.css 里气泡/头像相关的旧样式

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/index.css:822-934`（RP-023/RP-056 消息气泡与头像样式区块）

- [ ] **Step 1: 移除 `.ai-avatar` 系列规则**

删除 `src/index.css` 里以下整段（原第 895-914 行"AI Workbench: Avatars"注释及其下三条规则）：

```css
/* ── AI Workbench: Avatars ── */
.ai-avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 12px;
  flex-shrink: 0;
  letter-spacing: -0.02em;
}
.ai-avatar--bot {
  background: var(--brand);
  color: #fff;
}
.ai-avatar--user {
  background: var(--brand-soft);
  color: var(--brand-ink);
}
```

- [ ] **Step 2: 移除 `.ai-bubble--*` 视觉规则（保留选择器可以整体删除，因为 Task 3 已不再引用这些类名）**

删除原第 916-934 行"AI Workbench: Message Bubbles"整段：

```css
/* ── AI Workbench: Message Bubbles ── */
.ai-bubble--ai {
  background: var(--bg-soft, #f8f9fb);
  color: var(--ink);
  border: 1px solid var(--line);
  box-shadow: none;
}
.ai-bubble--user {
  background: var(--brand);
  color: #fff;
  border: none;
  box-shadow: 0 2px 8px -2px oklch(0.42 0.14 262 / 0.25);
}
.ai-bubble--error {
  background: #fff7f7;
  color: var(--err);
  border: 1px solid color-mix(in oklab, var(--err) 28%, var(--line));
  box-shadow: none;
}
```

- [ ] **Step 3: 移除已废弃的 `.ai-message-trace` 系列规则（原 ModelRunTrace 专用，ThinkingTrace 用 Tailwind class 重写，不再依赖这些）**

先确认没有其他文件引用：

Run: `cd ui/V2_PROTOTYPE && grep -rln "ai-message-trace" src --include="*.jsx"`
Expected: 无输出（Task 3 已删除唯一使用者 `ModelRunTrace.jsx`）

确认无输出后，删除 `src/index.css` 第 124-158 行（`.ai-code-block code` 规则之后、`.ai-md-h1` 系列规则之前）：

```css
.ai-message-trace {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--line, #e5e7eb);
  color: var(--ink-3, #6b7280);
  font-size: 11.5px;
}

.ai-message-trace span,
.ai-message-trace code {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 7px;
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 6px;
  background: var(--bg-soft, #f3f4f6);
  font-size: 11px;
  font-weight: 700;
}

.ai-message-trace span:first-child {
  border-color: color-mix(in oklab, var(--brand, #4f46e5) 30%, var(--line, #e5e7eb));
  background: var(--brand-soft, #eef2ff);
  color: var(--brand, #4f46e5);
}

.ai-message-trace code {
  font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace);
  color: var(--ink-2, #4b5563);
}
```

注意：`ai-badge-fade-in` 关键帧（在这段之后、`.ai-md-h1` 更靠后的位置）仍被 `MessageBits.jsx` 的 `HoverBadge` 组件使用，不在删除范围内，保留不动。

- [ ] **Step 4: 运行完整测试套件**

Run: `cd ui/V2_PROTOTYPE && npm run test`
Expected: 49 个测试文件全部 PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/kevin/AI/Workload-evaluation-system
git add ui/V2_PROTOTYPE/src/index.css
git commit -m "chore(V2_PROTOTYPE): 清理气泡/头像/ai-message-trace 废弃样式"
```

---

### Task 5: 回答正文表格/代码块视觉打磨

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/index.css:177-219`（`.ai-md-table-wrap`/`.ai-md-table` 规则）

- [ ] **Step 1: 修改表格样式，去卡片边框只留分隔线**

把：

```css
.ai-md-table-wrap {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  margin: 10px 0 14px;
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 8px;
  background: #fff;
}
```

改为：

```css
.ai-md-table-wrap {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  margin: 10px 0 14px;
}
```

把：

```css
.ai-md-table th,
.ai-md-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line, #e5e7eb);
  border-right: 1px solid var(--line, #e5e7eb);
  text-align: left;
  vertical-align: top;
  color: var(--ink-2, #4b5563);
}

.ai-md-table th:last-child,
.ai-md-table td:last-child {
  border-right: 0;
}
```

改为（去掉列之间的竖线，只保留行分隔）：

```css
.ai-md-table th,
.ai-md-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line, #e5e7eb);
  text-align: left;
  vertical-align: top;
  color: var(--ink-2, #4b5563);
}
```

`.ai-md-table th` 的背景色规则（`background: var(--bg-soft, #f3f4f6)`）保留不变——表头仍需要和表体有区分，只是表格外层不再是白底卡片。

代码块 `.ai-code-block`（深色卡片背景）**保持不动**——按设计文档，代码块是唯一在正文渲染层级保留背景色的例外。

- [ ] **Step 2: 浏览器视觉核对**

用 preview_start 打开 dev server，找一条含表格或代码块的历史 AI 回复消息，截图确认表格去边框、代码块保持深色卡片不变。

- [ ] **Step 3: 提交**

```bash
cd /Users/kevin/AI/Workload-evaluation-system
git add ui/V2_PROTOTYPE/src/index.css
git commit -m "style(V2_PROTOTYPE): AI 回答正文表格去卡片边框，代码块样式保持不变"
```

---

### Task 6: InteractiveFormCard 边框极简化

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/index.css:288-296`（`.ai-form-card` 规则）

- [ ] **Step 1: 修改样式**

把：

```css
.ai-form-card {
  display: grid;
  gap: 12px;
  margin: 12px 0 2px;
  padding: 12px;
  border: 1px solid color-mix(in oklab, var(--brand, #4f46e5) 18%, var(--line, #e5e7eb));
  border-radius: 8px;
  background: linear-gradient(180deg, #fff, color-mix(in oklab, var(--brand-soft, #eef2ff) 22%, #fff));
}
```

改为：

```css
.ai-form-card {
  display: grid;
  gap: 12px;
  margin: 12px 0 2px;
  padding: 12px;
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 8px;
  background: transparent;
}
```

- [ ] **Step 2: 运行涉及 InteractiveFormCard 的既有测试**

Run: `cd ui/V2_PROTOTYPE && npx vitest run src/__tests__/HomeWorkspace.test.jsx -t "inline report editing"`
Expected: PASS（这条用例覆盖了表单渲染路径）

- [ ] **Step 3: 提交**

```bash
cd /Users/kevin/AI/Workload-evaluation-system
git add ui/V2_PROTOTYPE/src/index.css
git commit -m "style(V2_PROTOTYPE): InteractiveFormCard 边框极简化，去渐变背景"
```

---

### Task 7: 建议操作 / DraftLinker 视觉一致化

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/WorkspacePanel/DraftLinker.jsx`

（`MessageBubble.jsx` 里 `suggestedActions` 的 `action.primary` 判断已在 Task 3 完成，本任务只需确认 `DraftLinker` 保持一致，它已经在用 `action.primary` 区分 `btn-pri`/`btn-out`，视觉语言天然一致，无需改动逻辑。）

- [ ] **Step 1: 统一按钮间距写法**

把 `DraftLinker.jsx` 里的：

```jsx
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
```

改为：

```jsx
    <div className="mt-2.5 flex flex-wrap gap-2">
```

（与 Task 3 里 `MessageBubble.jsx` 的 `suggestedActions` 容器写法保持字面一致，纯视觉数值不变：`marginTop: 10` ≈ `mt-2.5`，`gap: 8` = `gap-2`。）

- [ ] **Step 2: 运行测试确认无回归**

Run: `cd ui/V2_PROTOTYPE && npx vitest run src/__tests__/HomeWorkspace.test.jsx`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
cd /Users/kevin/AI/Workload-evaluation-system
git add ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/WorkspacePanel/DraftLinker.jsx
git commit -m "style(V2_PROTOTYPE): DraftLinker 按钮间距写法与 suggestedActions 对齐"
```

---

### Task 8: Composer 视觉打磨

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/index.css:942-950`（`.ai-composer__inner` 规则）

- [ ] **Step 1: 减轻输入框边框与阴影**

把：

```css
.ai-composer__inner {
  display: grid;
  gap: 8px;
  border: 1.5px solid var(--line);
  border-radius: 14px;
  padding: 10px 12px;
  background: var(--bg-soft);
  box-shadow: var(--shadow-1);
  transition: border-color 0.15s ease-out, box-shadow 0.15s ease-out;
}
```

改为：

```css
.ai-composer__inner {
  display: grid;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 10px 12px;
  background: var(--bg-soft);
  box-shadow: none;
  transition: border-color 0.15s ease-out, box-shadow 0.15s ease-out;
}
```

聚焦态 `.ai-composer__inner:focus-within` 的 `box-shadow: var(--shadow-focus)` 保留不变（聚焦时的强调阴影是有意义的交互反馈，不属于"静态卡片阴影"）。

- [ ] **Step 2: 浏览器视觉核对**

打开 dev server，检查输入框静止态边框变细、阴影消失，聚焦态仍有强调阴影。

- [ ] **Step 3: 提交**

```bash
cd /Users/kevin/AI/Workload-evaluation-system
git add ui/V2_PROTOTYPE/src/index.css
git commit -m "style(V2_PROTOTYPE): Composer 输入框边框减轻，去静态阴影"
```

---

### Task 9: 新建 BackgroundRunsPanel，替换后台任务徽标+单条停止横条

**Files:**
- Create: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/BackgroundRunsPanel.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/background-runs-panel.test.jsx`
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/index.jsx:35,143-161`
- Modify: `ui/V2_PROTOTYPE/src/index.css:424-446`（删除 `.ai-home-stop-bar` 系列规则）

- [ ] **Step 1: 写失败测试**

创建 `ui/V2_PROTOTYPE/src/__tests__/background-runs-panel.test.jsx`：

```jsx
import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BackgroundRunsPanel from '../pages/AiHomeWorkbench/components/ChatArea/BackgroundRunsPanel.jsx'

describe('BackgroundRunsPanel', () => {
  test('进行中和已完成都为 0 时不渲染', () => {
    const { container } = render(
      <BackgroundRunsPanel runs={[]} runCounts={{ active: 0, completed: 0 }} onStopRun={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  test('渲染顶部计数摘要', () => {
    render(
      <BackgroundRunsPanel runs={[]} runCounts={{ active: 0, completed: 3 }} onStopRun={() => {}} />,
    )
    expect(screen.getByText('后台任务 进行中 0 · 已完成 3')).toBeInTheDocument()
  })

  test('活跃任务逐行渲染，每行带停止按钮', () => {
    const onStopRun = vi.fn()
    const runs = [
      { runId: 'r1', title: '任务A', status: 'running', sessionId: 's1' },
      { runId: 'r2', title: '任务B', status: 'queued', sessionId: 's2' },
    ]
    render(
      <BackgroundRunsPanel runs={runs} runCounts={{ active: 2, completed: 0 }} onStopRun={onStopRun} />,
    )
    expect(screen.getByText('任务A')).toBeInTheDocument()
    expect(screen.getByText('任务B')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('停止后台任务：任务A'))
    expect(onStopRun).toHaveBeenCalledWith(runs[0])
  })

  test('已完成/失败状态的 run 不出现在行列表里（只计入顶部计数）', () => {
    const runs = [
      { runId: 'r1', title: '任务A', status: 'completed', sessionId: 's1' },
      { runId: 'r2', title: '任务B', status: 'running', sessionId: 's2' },
    ]
    render(
      <BackgroundRunsPanel runs={runs} runCounts={{ active: 1, completed: 1 }} onStopRun={() => {}} />,
    )
    expect(screen.queryByText('任务A')).not.toBeInTheDocument()
    expect(screen.getByText('任务B')).toBeInTheDocument()
  })

  test('超过 2 条活跃任务时默认折叠，点击展开全部', () => {
    const runs = [
      { runId: 'r1', title: '任务A', status: 'running', sessionId: 's1' },
      { runId: 'r2', title: '任务B', status: 'running', sessionId: 's2' },
      { runId: 'r3', title: '任务C', status: 'running', sessionId: 's3' },
    ]
    render(
      <BackgroundRunsPanel runs={runs} runCounts={{ active: 3, completed: 0 }} onStopRun={() => {}} />,
    )
    expect(screen.getByText('任务A')).toBeInTheDocument()
    expect(screen.getByText('任务B')).toBeInTheDocument()
    expect(screen.queryByText('任务C')).not.toBeInTheDocument()
    expect(screen.getByText('还有 1 项')).toBeInTheDocument()

    fireEvent.click(screen.getByText('还有 1 项'))
    expect(screen.getByText('任务C')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ui/V2_PROTOTYPE && npx vitest run src/__tests__/background-runs-panel.test.jsx`
Expected: FAIL，报错找不到 `BackgroundRunsPanel.jsx`

- [ ] **Step 3: 实现 BackgroundRunsPanel.jsx**

创建 `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/BackgroundRunsPanel.jsx`：

```jsx
import { useState } from 'react'

const ACTIVE_STATUSES = new Set(['queued', 'running', 'recovering', 'waiting'])
const VISIBLE_ROW_LIMIT = 2

function statusDotClassName(status) {
  if (status === 'completed') return 'bg-ok'
  if (status === 'failed' || status === 'cancelled') return 'bg-err'
  return 'bg-brand animate-pulse'
}

/**
 * 后台任务面板：取代原来"一行文字徽标 + 单条当前会话停止横条"。
 * 顶部计数摘要数据源与既有 runCounts 计算逻辑保持不变；
 * 新增的逐行列表只展示 backgroundRuns.runs 里处于活跃状态的任务，
 * 每行独立可停止；已完成/失败的 run 只体现在顶部计数里，不出现在行列表
 * （backgroundRuns.runs 不保证覆盖全部历史已完成任务，行级展示只对
 * 当前仍在追踪的活跃任务做承诺）。
 */
export default function BackgroundRunsPanel({ runs, runCounts, onStopRun }) {
  const [expanded, setExpanded] = useState(false)

  if (runCounts.active === 0 && runCounts.completed === 0) return null

  const activeRuns = Array.isArray(runs) ? runs.filter((run) => ACTIVE_STATUSES.has(run.status)) : []
  const visibleRuns = expanded ? activeRuns : activeRuns.slice(0, VISIBLE_ROW_LIMIT)
  const hiddenCount = activeRuns.length - visibleRuns.length

  return (
    <div role="status" className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-bg-2 px-3 py-1.5 text-xs text-ink-2">
      <span>{`后台任务 进行中 ${runCounts.active} · 已完成 ${runCounts.completed}`}</span>
      {visibleRuns.map((run, idx) => (
        <div
          key={run.runId}
          className={`flex items-center gap-2 ${idx === 0 ? '' : 'border-t border-line pt-1.5'}`}
        >
          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${statusDotClassName(run.status)}`} />
          <span className="min-w-0 flex-1 truncate">{run.title || run.runId}</span>
          <button
            type="button"
            className="btn btn-out shrink-0"
            style={{ height: 24, padding: '0 10px', fontSize: 11 }}
            onClick={() => onStopRun(run)}
            aria-label={`停止后台任务：${run.title || run.runId}`}
          >
            停止
          </button>
        </div>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="cursor-pointer self-start border-0 bg-transparent p-0 text-[11px] text-ink-3 underline"
        >
          还有 {hiddenCount} 项
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd ui/V2_PROTOTYPE && npx vitest run src/__tests__/background-runs-panel.test.jsx`
Expected: PASS，5 个测试全绿

- [ ] **Step 5: 在 index.jsx 接入 BackgroundRunsPanel，移除旧的徽标+停止横条**

在 `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/index.jsx` 顶部 import 区加入：

```js
import BackgroundRunsPanel from './components/ChatArea/BackgroundRunsPanel.jsx'
```

删除第 35 行：

```js
  const activeRun = workbench.activeSession ? sessionRuns[workbench.activeSession.sessionId] : null
```

把第 147-161 行：

```jsx
        {(runCounts.active > 0 || runCounts.completed > 0) && (
          <div
            className="ai-home-runs-badge"
            role="status"
            style={{ display: 'flex', alignItems: 'center', minHeight: 34, padding: '6px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--bg-2)', fontSize: 12, color: 'var(--ink-2)' }}
          >
            {`后台任务 进行中 ${runCounts.active} · 已完成 ${runCounts.completed}`}
          </div>
        )}
        {activeRun && (
          <div className="ai-home-stop-bar" role="status">
            <span className="ai-home-stop-bar-text">后台任务执行中：{activeRun.title || activeRun.runId}</span>
            <button type="button" className="btn btn-out" style={{ height: 26, padding: '0 12px', fontSize: 12, flexShrink: 0 }} onClick={() => requestStopRun(activeRun)}>停止任务</button>
          </div>
        )}
```

改为：

```jsx
        <BackgroundRunsPanel runs={backgroundRuns.runs} runCounts={runCounts} onStopRun={requestStopRun} />
```

- [ ] **Step 6: 删除 index.css 里的 `.ai-home-runs-badge` inline style 对应的旧类（已改用 BackgroundRunsPanel 内联 Tailwind class，无需 CSS 规则）与 `.ai-home-stop-bar` 规则**

删除 `src/index.css` 第 424-446 行：

```css
/* RP-047 Batch D（G4）：当前会话有后台任务时的页面级停止入口条 */
.ai-home-stop-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 10px;
  background: var(--bg-soft);
  flex-shrink: 0;
}
.ai-home-stop-bar-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 7: 运行 index.jsx 相关的既有测试确认无回归**

Run: `cd ui/V2_PROTOTYPE && npx vitest run src/__tests__/HomeWorkspace.test.jsx src/__tests__/session-isolation.test.jsx src/__tests__/streaming-ux.test.jsx`
Expected: PASS 全部通过

- [ ] **Step 8: 提交**

```bash
cd /Users/kevin/AI/Workload-evaluation-system
git add ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/BackgroundRunsPanel.jsx ui/V2_PROTOTYPE/src/__tests__/background-runs-panel.test.jsx ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/index.jsx ui/V2_PROTOTYPE/src/index.css
git commit -m "feat(V2_PROTOTYPE): 新建 BackgroundRunsPanel 逐行任务列表，替换单条停止横条"
```

---

### Task 10: AttachmentCard 视觉打磨

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/AttachmentCard.jsx`

- [ ] **Step 1: 去掉阴影，边框统一为极简描边**

把文件里最外层容器的 `style` 对象：

```jsx
      style={{
        display: 'grid',
        gridTemplateColumns: '40px minmax(0,1fr) auto',
        alignItems: 'center',
        gap: 10,
        padding: compact ? '8px 10px' : '9px 10px',
        border: inverted ? '1px solid rgba(255,255,255,.28)' : '1px solid var(--line)',
        borderRadius: 10,
        background: inverted ? 'rgba(255,255,255,.14)' : 'var(--bg-soft)',
        boxShadow: compact || inverted ? 'none' : '0 1px 0 rgba(15,23,42,.03)',
        minWidth: 0,
      }}
```

改为（去掉 `boxShadow` 属性，其余不变）：

```jsx
      style={{
        display: 'grid',
        gridTemplateColumns: '40px minmax(0,1fr) auto',
        alignItems: 'center',
        gap: 10,
        padding: compact ? '8px 10px' : '9px 10px',
        border: inverted ? '1px solid rgba(255,255,255,.28)' : '1px solid var(--line)',
        borderRadius: 10,
        background: inverted ? 'rgba(255,255,255,.14)' : 'var(--bg-soft)',
        minWidth: 0,
      }}
```

- [ ] **Step 2: 运行涉及附件卡片的既有测试**

Run: `cd ui/V2_PROTOTYPE && npx vitest run src/__tests__/HomeWorkspace.test.jsx -t "attached"`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
cd /Users/kevin/AI/Workload-evaluation-system
git add ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/AttachmentCard.jsx
git commit -m "style(V2_PROTOTYPE): AttachmentCard 去阴影，边框统一极简描边"
```

---

### Task 11: 全量验证

**Files:** 无新改动，纯验证

- [ ] **Step 1: 全量单元测试**

Run: `cd ui/V2_PROTOTYPE && npm run test`
Expected: 全部测试文件 PASS（含 Task 1/9 新增的 `thinking-trace.test.jsx`、`background-runs-panel.test.jsx`）

- [ ] **Step 2: 生产构建**

Run: `cd ui/V2_PROTOTYPE && npm run build`
Expected: 构建成功，无报错

- [ ] **Step 3: 浏览器视觉核对**

用 preview_start 打开 dev server（`npm run dev`），登录后在 AI 工作台走一轮真实对话，依次截图核对：
1. assistant 纯文本回复（无头像、无气泡背景）
2. user 消息（右对齐、字重 medium、无气泡背景）
3. loading 态（像素网格 loader 裸露在文本流中）
4. 触发一次带工具调用/知识检索的回复，展开 ThinkingTrace 核对分组顺序
5. 触发一次表单确认卡片（InteractiveFormCard），核对边框极简化
6. 后台任务面板：触发 2 个以上并发任务，核对逐行列表 + 展开"还有 N 项"
7. 错误消息（`message.error` 为 true 的场景），核对左侧红色竖线呈现

- [ ] **Step 4: 提交（如果验证过程中有修复）**

如果 Step 1-3 发现问题并修复，按标准流程提交；如果全部一次通过，本任务无需提交，直接进入收尾。

---

## 收尾

全部任务完成后，把这次改造同步进设计文档的状态记录（可选：在 `docs/superpowers/specs/2026-08-17-ai-workbench-message-ui-modernization-design.md` 顶部加一行"实施状态：已完成，见 plans/2026-08-17-ai-workbench-message-ui-modernization.md"）。
