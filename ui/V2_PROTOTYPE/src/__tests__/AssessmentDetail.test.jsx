import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import AssessmentDetail from '../pages/AssessmentDetail.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

describe('AssessmentDetail', () => {
  test('renders ai draft source banner with harness trace', async () => {
    server.use(http.get(`${BASE}/versions/:id`, () => HttpResponse.json({
      success: true,
      data: {
        id: 'ASM-AI-001',
        type: 'assessment',
        versionCode: 'IA-AI-DRAFT-001',
        baseCode: 'GL-AI-001',
        status: 'draft',
        checkoutStatus: 'checked_in',
        versionDocStatus: 'drafting',
        updatedByUsername: 'ai',
        updatedAt: '2026-06-18T08:00:00Z',
        templateId: 'tmpl-1',
        ruleSetId: 'DSL-2026-Q2',
        payload: {
          projectName: 'AI 生成项目评估草稿',
          productLine: '金蝶AI星空',
          totalDays: 0,
          draftStatus: 'draft_from_ai',
          draftSource: 'harness',
          harnessRunId: 'run-ai-001',
          harnessActionId: 'enter_formal_estimation',
        },
      },
    })))

    render(
      <MemoryRouter initialEntries={['/assessments/ASM-AI-001']}>
        <Routes>
          <Route path="/assessments/:id" element={<AssessmentDetail />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText('AI 草稿 · 待人工确认')).toBeInTheDocument())
    expect(screen.getByText(/尚未进入正式评估流程/)).toBeInTheDocument()
    expect(screen.getByText('Harness Run: run-ai-001')).toBeInTheDocument()
    expect(screen.getByText('动作: enter_formal_estimation')).toBeInTheDocument()
    expect(screen.getByText('版本: IA-AI-DRAFT-001')).toBeInTheDocument()
  })

  test('confirms ai draft and shows harness audit write-back status', async () => {
    let confirmed = false
    let getCalls = 0
    server.use(
      http.get(`${BASE}/versions/:id`, () => {
        getCalls += 1
        return HttpResponse.json({
          success: true,
          data: {
            id: 'ASM-AI-001',
            type: 'assessment',
            versionCode: 'IA-AI-DRAFT-001',
            baseCode: 'GL-AI-001',
            status: 'draft',
            checkoutStatus: 'checked_in',
            versionDocStatus: 'drafting',
            updatedByUsername: confirmed ? 'elly' : 'ai',
            updatedAt: confirmed ? '2026-06-19T09:00:00Z' : '2026-06-18T08:00:00Z',
            templateId: 'tmpl-1',
            ruleSetId: 'DSL-2026-Q2',
            payload: {
              projectName: 'AI 生成项目评估草稿',
              productLine: '金蝶AI星空',
              totalDays: 0,
              draftStatus: 'draft_from_ai',
              draftSource: 'harness',
              harnessRunId: 'run-ai-001',
              harnessActionId: 'enter_formal_estimation',
              ...(confirmed ? {
                aiDraftReview: {
                  status: 'confirmed',
                  confirmedAt: '2026-06-19T09:00:00Z',
                  confirmedByUsername: 'elly',
                  harnessToolEventId: 'tool-1',
                },
              } : {}),
            },
          },
        })
      }),
      http.post(`${BASE}/project-evaluations/assessment-drafts/:assessmentId/confirm`, () => {
        confirmed = true
        return HttpResponse.json({
        code: 0,
        message: 'ok',
        data: {
          assessmentDraft: {
            recordId: 'ASM-AI-001',
            versionCode: 'IA-AI-DRAFT-001',
            status: 'draft_from_ai',
            manualConfirmation: {
              status: 'confirmed',
              confirmedAt: '2026-06-19T09:00:00Z',
              confirmedByUsername: 'elly',
              harnessToolEventId: 'tool-1',
            },
          },
          harness: {
            runId: 'run-ai-001',
            actionId: 'enter_formal_estimation',
            toolEventId: 'tool-1',
            status: 'confirmed',
          },
        },
        })
      })
    )

    render(
      <MemoryRouter initialEntries={['/assessments/ASM-AI-001']}>
        <Routes>
          <Route path="/assessments/:id" element={<AssessmentDetail />} />
        </Routes>
      </MemoryRouter>
    )

    const confirmButton = await screen.findByRole('button', { name: '确认 AI 草稿' })
    fireEvent.click(confirmButton)

    await waitFor(() => expect(screen.getByText('AI 草稿 · 已人工确认')).toBeInTheDocument())
    await waitFor(() => expect(getCalls).toBeGreaterThanOrEqual(2))
    expect(screen.getByText(/已回写 Harness 审计/)).toBeInTheDocument()
    expect(screen.getByText('ToolEvent: tool-1')).toBeInTheDocument()
  })
})
