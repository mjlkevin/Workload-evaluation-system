# WES Agent RP-013 Interactive FormBlock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. If only one worker is available, use superpowers:executing-plans and keep the checkbox state current after each task.

**Goal:** Deliver RP-013 so AI Workbench replies can include a safe, structured `formBlock` that renders as an interactive form in `ui/V2_PROTOTYPE`, lets the user submit missing information in one click, and degrades to the existing Markdown reply when the structure is absent or invalid.

**Architecture:** Keep `ui/V2_PROTOTYPE` as the only Web mainline and `apps/api` as the only backend entry. Extend the existing AI workbench dispatch response with an optional, validated protocol object. Persist that protocol on assistant session messages through metadata so reload and session switching preserve the interaction. Do not introduce another frontend, backend service, database path, or write-action shortcut.

**Tech Stack:** Express + TypeScript service layer in `apps/api`; file-backed AI session records; Vite + React 18 in `ui/V2_PROTOTYPE`; Vitest for frontend tests; Node test runner through `tsx` for API tests.

---

## Protocol Decision

Use a whitelisted protocol owned by the backend before the frontend renders anything:

```ts
export type InteractiveFormFieldType = "text" | "textarea" | "single_select" | "boolean" | "number";

export type InteractiveFormField = {
  id: string;
  label: string;
  type: InteractiveFormFieldType;
  required?: boolean;
  placeholder?: string;
  helperText?: string;
  options?: Array<{ label: string; value: string }>;
};

export type InteractiveFormBlock = {
  blockId: string;
  title: string;
  description?: string;
  submitLabel: string;
  submitMessageTemplate?: string;
  fields: InteractiveFormField[];
};
```

Validation constraints:

- `blockId`, `title`, `submitLabel`, each field `id`, and each field `label` are required non-empty strings.
- `type` must be one of the five whitelisted values.
- `fields` must contain 1 to 8 items.
- `single_select` must contain 1 to 8 options; other field types ignore options.
- Invalid protocol returns `formBlock: undefined` and preserves the normal Markdown answer.
- Submitting a form only sends a normal user chat message; it must not create, update, link, or confirm records without the existing explicit confirmation flow.

## Task Checklist

- [x] Backend protocol types and validator

  Files:
  - `apps/api/src/services/ai/workbench-dispatch.service.ts`

  Steps:
  1. Add `InteractiveFormFieldType`, `InteractiveFormField`, and `InteractiveFormBlock` exports next to `WorkbenchSuggestedAction`.
  2. Add `formBlock?: InteractiveFormBlock` to `WorkbenchDispatchData`.
  3. Implement `normalizeInteractiveFormBlock(input: unknown): InteractiveFormBlock | undefined`.
  4. Implement a parser for model output that accepts a fenced JSON block containing `{ "formBlock": ... }` or top-level JSON with `formBlock`.
  5. Strip the protocol JSON from `answer` only after a valid `formBlock` is extracted; leave the original answer untouched on invalid JSON.

- [x] Backend dispatch prompt and tests

  Files:
  - `apps/api/src/services/ai/workbench-dispatch.service.ts`
  - `apps/api/src/services/ai/workbench-dispatch.service.test.ts`
  - `apps/api/package.json`

  Steps:
  1. Extend the model system prompt in `answerWithModelAndContext` with a compact instruction: when the assistant needs structured user input, append one JSON block containing `formBlock`.
  2. Add tests for valid `formBlock` extraction, invalid protocol downgrade, and display-answer cleanup.
  3. Add the new test file to the `test:modules` script so `npm run test:modules` covers the protocol.

  Expected targeted command:

  ```bash
  npm run test:modules
  ```

- [x] AI session persistence and API response

  Files:
  - `apps/api/src/modules/ai-sessions/ai-sessions.types.ts`
  - `apps/api/src/services/ai/chat.service.ts`
  - `docs/openapi.yaml`
  - `03_技术设计/系统演进/实现与文档对齐说明.md`

  Steps:
  1. Add optional `metadata?: Record<string, unknown>` to `AiMessage`.
  2. When `homeWorkbenchChat` appends the assistant turn, store `{ formBlock: dispatchData.formBlock }` in `metadata` only when present.
  3. Return `formBlock` in the `/api/v1/ai/home-workbench/chat` response.
  4. Update OpenAPI and the implementation alignment note so external contract and implementation stay consistent.

- [x] Frontend interactive form component

  Files:
  - `ui/V2_PROTOTYPE/src/components/AiWorkbench/InteractiveFormCard.jsx`
  - `ui/V2_PROTOTYPE/src/index.css`

  Steps:
  1. Render `text`, `textarea`, `number`, `boolean`, and `single_select` controls with stable dimensions.
  2. Validate required fields locally before submit.
  3. Generate the submitted chat message from `submitMessageTemplate` when present; otherwise use a readable bullet list of labels and values.
  4. Keep the component visually consistent with existing workbench controls and avoid explanatory wall text inside the card.

- [x] Frontend workbench integration

  Files:
  - `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`

  Steps:
  1. Preserve `message.metadata?.formBlock` when mapping session messages.
  2. If a fresh chat response returns `formBlock` but the session payload does not yet include metadata, attach the block to the latest assistant message in local state.
  3. Render `InteractiveFormCard` under `RichAiMessage` and above artifacts or suggested actions.
  4. On submit, call the existing `sendMessage(messageOverride)` path so the form response is audited as a normal user turn.

- [x] Frontend regression tests

  Files:
  - `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`

  Steps:
  1. Add a test that mocks a chat response containing `formBlock`, renders the form fields, submits values, and asserts the next `/ai/home-workbench/chat` request includes the generated user message.
  2. Add a reload/session mapping assertion if existing session fixtures can include message metadata without broad fixture churn.
  3. Keep the existing RP-020 option-card test passing so heuristic option rendering and structured form rendering can coexist.

  Expected targeted command:

  ```bash
  npm run test --prefix ui/V2_PROTOTYPE -- --run src/__tests__/HomeWorkspace.test.jsx
  ```

- [x] Final verification and documentation

  Commands:

  ```bash
  npm run test:modules
  npm run test --prefix ui/V2_PROTOTYPE
  npm run build:api
  npm run build:web
  ```

  Board pages to update after implementation:
  - `03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/requirements-editor.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/plan.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/risks.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/sources.html`

## Acceptance Criteria

- AI workbench API responses can include a validated `formBlock` without changing existing responses that only return Markdown.
- Invalid model JSON or unsupported field types never crash the frontend and never render unsafe controls.
- A structured form survives session reload through assistant message metadata.
- User submit flows through the existing chat send path and remains visible in the conversation history.
- RP-020 guided option cards still render and remain independent from `formBlock`.
- The final implementation passes API module tests, frontend tests, API build, and V2 web build.
