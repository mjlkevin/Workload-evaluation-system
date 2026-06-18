import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import useSystemManagement from '../hooks/useSystemManagement.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

describe('useSystemManagement', () => {
  test('loads rules, models, dsl and templates in parallel', async () => {
    const { result } = renderHook(() => useSystemManagement())

    await waitFor(() => expect(result.current.rules[0].code).toBe('GL'))
    await waitFor(() => expect(result.current.models[0].name).toBe('KIMI 评估'))
    await waitFor(() => expect(result.current.dslRules).toHaveLength(3))
    await waitFor(() => expect(result.current.templates[0].name).toBe('实施评估标准版'))
  })

  test('toggleDsl switches local enabled state', async () => {
    const { result } = renderHook(() => useSystemManagement())
    await waitFor(() => expect(result.current.dslRules).toHaveLength(3))

    const before = result.current.dslRules.find((rule) => rule.id === 'R1').enabled
    act(() => {
      result.current.actions.toggleDsl('R1')
    })

    expect(result.current.dslRules.find((rule) => rule.id === 'R1').enabled).toBe(!before)
  })

  test('activateRule calls API and updates status', async () => {
    let activated = null
    server.use(http.post(`${BASE}/system/version-code-rules/:id/activate`, ({ params }) => {
      activated = params.id
      return HttpResponse.json({ success: true, data: {} })
    }))
    const { result } = renderHook(() => useSystemManagement())
    await waitFor(() => expect(result.current.rules[0].code).toBe('GL'))

    await act(async () => {
      await result.current.actions.activateRule('GL')
    })

    expect(activated).toBe('GL')
    expect(result.current.rules.find((rule) => rule.code === 'GL').status).toBe('active')
  })

  test('enabled=false uses fallback data', async () => {
    const fallbackData = { rules: [{ code: 'FB', status: 'draft' }], models: [], dslRules: [], templates: [] }
    const { result } = renderHook(() => useSystemManagement({ enabled: false, fallbackData }))
    expect(result.current.rules[0].code).toBe('FB')
  })
})
