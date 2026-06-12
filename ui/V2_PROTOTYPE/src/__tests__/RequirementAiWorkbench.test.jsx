import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import RequirementAiWorkbench from '../pages/RequirementAiWorkbench.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

function renderWorkbench(id = 'REQ-AI-1') {
  return render(
    <MemoryRouter initialEntries={[`/requirements/${id}/ai-evaluation`]}>
      <Routes>
        <Route path="/requirements/:id/ai-evaluation" element={<RequirementAiWorkbench />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RequirementAiWorkbench', () => {
  test('does not show saved rule fallback as a completed AI evaluation', async () => {
    server.use(http.get(`${BASE}/versions/:id`, () => HttpResponse.json({
      success: true,
      data: {
        id: 'REQ-AI-1',
        versionCode: 'RQ-UT',
        checkoutStatus: 'checked_in',
        payload: {
          aiEvaluation: {
            sourceFile: { name: 'legacy-rule.xlsx' },
            parseSummary: {
              fileName: 'legacy-rule.xlsx',
              rawRows: 19,
              topics: 4,
              integrationRisks: 19,
              confirmQuestions: 4,
              mode: 'rule_fallback',
            },
            lastPreview: {
              meta: { mode: 'rule_fallback', model: 'rule-fallback' },
              assessmentDraft: {
                moduleItems: [{ moduleName: '旧规则项', suggestedDays: 3 }],
              },
            },
            userInstruction: '请解析文件',
          },
        },
      },
    })))

    renderWorkbench()

    await waitFor(() => expect(screen.getByText(/旧规则兜底结果已停用/)).toBeInTheDocument())
    expect(screen.queryByText('文件识别完成')).not.toBeInTheDocument()
    expect(screen.queryByText('可评估')).not.toBeInTheDocument()
    expect(screen.queryByText('rule_fallback')).not.toBeInTheDocument()
    expect(screen.queryByText('旧规则项')).not.toBeInTheDocument()
  })

  test('restores saved thread messages after refresh', async () => {
    server.use(http.get(`${BASE}/versions/:id`, () => HttpResponse.json({
      success: true,
      data: {
        id: 'REQ-AI-2',
        versionCode: 'RQ-MEMORY',
        checkoutStatus: 'checked_in',
        payload: {
          aiEvaluation: {
            activeThreadId: 'thread_memory',
            threads: [{
              id: 'thread_memory',
              title: '刷新恢复测试',
              status: 'active',
              messages: [
                {
                  id: 'msg_user_1',
                  role: 'user',
                  type: 'file_request',
                  content: '请解析这份需求文件并保留对话',
                  attachments: [{ name: 'memory.xlsx', size: 2048 }],
                  createdAt: '2026-06-12T10:00:00.000Z',
                },
                {
                  id: 'msg_ai_1',
                  role: 'assistant',
                  type: 'text',
                  content: '历史 AI 回复：已经完成初步理解。',
                  createdAt: '2026-06-12T10:00:01.000Z',
                },
              ],
              artifacts: {},
            }],
          },
        },
      },
    })))

    renderWorkbench('REQ-AI-2')

    expect(await screen.findByText('请解析这份需求文件并保留对话')).toBeInTheDocument()
    expect(screen.getByText('历史 AI 回复：已经完成初步理解。')).toBeInTheDocument()
    expect(screen.getByText('memory.xlsx')).toBeInTheDocument()
  })

  test('autosaves thread messages after analysis without pressing save draft', async () => {
    const saveBodies = []
    server.use(
      http.get(`${BASE}/versions/:id`, ({ params }) => HttpResponse.json({
        success: true,
        data: {
          id: params.id,
          versionCode: 'RQ-AUTOSAVE',
          checkoutStatus: 'checked_in',
          payload: { projectName: '自动保存测试' },
        },
      })),
      http.post(`${BASE}/ai/parse-basic-info`, () => HttpResponse.json({
        success: true,
        data: {
          model: 'kimi-k2.5',
          mode: 'model',
          requirementImportData: {
            businessNeedRows: [
              { businessDomain: '供应链', category: '采购', standardImplemented: '未实现', requiresCustomDev: true },
            ],
            valuePropositionRows: [],
            keyPointRows: [{ title: '接口风险' }],
          },
        },
      })),
      http.post(`${BASE}/ai/kimi-assessment/preview`, () => HttpResponse.json({
        success: true,
        data: {
          meta: { mode: 'model', model: 'kimi-k2.5' },
          assessmentDraft: {
            moduleItems: [{ cloudProduct: '供应链云', moduleName: '采购管理', suggestedDays: 5, standardDays: 3, reason: '存在接口联动' }],
            risks: ['接口需确认'],
            assumptions: ['按单组织上线'],
          },
        },
      })),
      http.patch(`${BASE}/versions/:id/save-draft`, async ({ request }) => {
        const body = await request.json()
        saveBodies.push(body)
        return HttpResponse.json({ success: true, data: { checkoutStatus: 'checked_out' } })
      }),
    )

    const { container } = renderWorkbench('REQ-AI-3')
    const file = new File(['demo'], 'autosave.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '请保留这轮对话' } })
    fireEvent.click(screen.getByRole('button', { name: '➤' }))

    await waitFor(() => expect(saveBodies.length).toBeGreaterThan(0))
    const messages = saveBodies.at(-1)?.payload?.aiEvaluation?.threads?.[0]?.messages || []
    expect(messages.map((message) => message.type)).toEqual(['file_request', 'parse_summary', 'assessment_preview'])
    expect(messages[0].content).toBe('请保留这轮对话')
    expect(messages[0].attachments?.[0]?.name).toBe('autosave.xlsx')
    expect(saveBodies.at(-1)?.payload?.aiEvaluation?.activeThreadId).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '加入待确认' }))

    await waitFor(() => expect(saveBodies.length).toBeGreaterThan(1))
    const updatedMessages = saveBodies.at(-1)?.payload?.aiEvaluation?.threads?.[0]?.messages || []
    expect(updatedMessages.at(-1)?.type).toBe('confirmation')
    expect(updatedMessages.at(-1)?.content).toContain('采购管理')
  })
})
