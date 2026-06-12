import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import RequirementAiWorkbench from '../pages/RequirementAiWorkbench.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

function renderWorkbench(id = 'REQ-AI-1') {
  render(
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
})
