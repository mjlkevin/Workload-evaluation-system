import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import useSystemManagement from '../hooks/useSystemManagement.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

const MOCK_DRAFT = {
  kimiEvaluation: { enabled: true, model: 'kimi-k2.5', temperature: 0.3, maxTokens: 4000, timeoutMs: 120000, fallbackToRule: true, promptProfile: 'default', promptTemplate: '' },
  fileParsing: { enabled: true, model: 'kimi-k2.6', allowedExtensions: ['.xlsx', '.xls', '.csv'], maxFileSizeMb: 20, maxSheetCount: 20, strictMode: false, ocrEnabled: false },
  kimiGeneration: { enabled: true, model: 'kimi-k2.5', temperature: 0.5, maxTokens: 6000, outputStyle: 'balanced', includeRiskHints: true, includeAssumptions: true },
  kimiCredentials: { apiKey: '', hint: null, envFallbackAvailable: false, resolvedFrom: 'none' },
}

describe('useSystemManagement', () => {
  test('loads rules, modelConfig, dsl and templates in parallel', async () => {
    const { result } = renderHook(() => useSystemManagement())

    await waitFor(() => expect(result.current.rules[0].code).toBe('GL'))
    await waitFor(() => expect(result.current.modelConfig.kimiEvaluation.model).toBe('kimi-k2.5'))
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
    const fallbackData = { rules: [{ code: 'FB', status: 'draft' }], dslRules: [], templates: [] }
    const { result } = renderHook(() => useSystemManagement({ enabled: false, fallbackData }))
    expect(result.current.rules[0].code).toBe('FB')
  })

  test('loadModels maps draft config from API response', async () => {
    const customDraft = {
      ...MOCK_DRAFT,
      kimiEvaluation: { ...MOCK_DRAFT.kimiEvaluation, enabled: false, model: 'custom-model', temperature: 0.7 },
      fileParsing: { ...MOCK_DRAFT.fileParsing, maxFileSizeMb: 50 },
      kimiGeneration: { ...MOCK_DRAFT.kimiGeneration, outputStyle: 'detailed' },
      kimiCredentials: { apiKey: '', hint: '····abcd', resolvedFrom: 'store', envFallbackAvailable: true },
    }
    server.use(
      http.get(`${BASE}/system/requirement-settings`, () =>
        HttpResponse.json({ success: true, data: { version: 3, draft: customDraft, active: MOCK_DRAFT, updatedAt: '2026-06-01T00:00:00Z', effectiveAt: '2026-06-01T00:00:00Z' } })
      )
    )
    const { result } = renderHook(() => useSystemManagement())

    await waitFor(() => expect(result.current.modelConfig.kimiEvaluation.model).toBe('custom-model'))
    expect(result.current.modelConfig.kimiEvaluation.enabled).toBe(false)
    expect(result.current.modelConfig.kimiEvaluation.temperature).toBe(0.7)
    expect(result.current.modelConfig.fileParsing.maxFileSizeMb).toBe(50)
    expect(result.current.modelConfig.kimiGeneration.outputStyle).toBe('detailed')
    expect(result.current.modelConfig.kimiCredentials.hint).toBe('····abcd')
  })

  test('updateModelConfig patches a sub-config locally', async () => {
    const { result } = renderHook(() => useSystemManagement())
    await waitFor(() => expect(result.current.modelConfig.kimiEvaluation).toBeDefined())

    act(() => {
      result.current.actions.updateModelConfig('kimiEvaluation', { temperature: 0.9, model: 'new-model' })
    })

    expect(result.current.modelConfig.kimiEvaluation.temperature).toBe(0.9)
    expect(result.current.modelConfig.kimiEvaluation.model).toBe('new-model')
    // Other sub-configs unaffected
    expect(result.current.modelConfig.fileParsing.enabled).toBe(true)
  })

  test('saveModelDraftWithKey sends correct schema to PATCH', async () => {
    let capturedBody = null
    server.use(
      http.patch(`${BASE}/system/requirement-settings/draft`, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ success: true, data: { version: 2, draft: capturedBody, updatedAt: new Date().toISOString() } })
      })
    )
    const { result } = renderHook(() => useSystemManagement())
    await waitFor(() => expect(result.current.modelConfig.kimiEvaluation).toBeDefined())

    act(() => {
      result.current.actions.updateModelConfig('kimiEvaluation', { temperature: 0.6 })
    })

    await act(async () => {
      await result.current.actions.saveModelDraftWithKey('sk-new-key-1234')
    })

    expect(capturedBody).not.toBeNull()
    expect(capturedBody.kimiEvaluation.temperature).toBe(0.6)
    expect(capturedBody.kimiCredentials.apiKey).toBe('sk-new-key-1234')
    expect(capturedBody.models).toBeUndefined()
  })

  test('clearApiKeyDraft sends null apiKey', async () => {
    let capturedBody = null
    server.use(
      http.patch(`${BASE}/system/requirement-settings/draft`, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ success: true, data: { version: 2, draft: capturedBody, updatedAt: new Date().toISOString() } })
      })
    )
    const { result } = renderHook(() => useSystemManagement())
    await waitFor(() => expect(result.current.modelConfig.kimiEvaluation).toBeDefined())

    await act(async () => {
      await result.current.actions.clearApiKeyDraft()
    })

    expect(capturedBody.kimiCredentials.apiKey).toBeNull()
  })

  test('saveKbDraft reports expired login instead of a false success when disabled', async () => {
    let patchCalls = 0
    server.use(
      http.patch(`${BASE}/system/knowledge-base-config/draft`, () => {
        patchCalls += 1
        return HttpResponse.json({ success: true, data: {} })
      })
    )
    const { result } = renderHook(() => useSystemManagement({ enabled: false }))

    let actionResult
    await act(async () => {
      actionResult = await result.current.actions.saveKbDraft()
    })

    expect(actionResult).toEqual({ success: false, error: '登录已过期，请重新登录' })
    expect(patchCalls).toBe(0)
    expect(window.alert).not.toHaveBeenCalled()
  })

  test('testKbConnectivity returns an explicit unauthorized result when disabled', async () => {
    const { result } = renderHook(() => useSystemManagement({ enabled: false }))

    let actionResult
    await act(async () => {
      actionResult = await result.current.actions.testKbConnectivity()
    })

    expect(actionResult).toEqual({
      ok: false,
      code: 'UNAUTHORIZED',
      status: 401,
      error: '登录已过期，请重新登录',
    })
  })

  test('saveKbDraft never shows success when the PATCH fails', async () => {
    server.use(
      http.patch(`${BASE}/system/knowledge-base-config/draft`, () =>
        HttpResponse.json({ code: 'SAVE_FAILED', message: '草稿保存失败' }, { status: 500 })
      )
    )
    const { result } = renderHook(() => useSystemManagement())

    let actionResult
    await act(async () => {
      actionResult = await result.current.actions.saveKbDraft()
    })

    expect(actionResult).toEqual({
      success: false,
      error: '草稿保存失败',
      status: 500,
      code: 'SAVE_FAILED',
      details: undefined,
    })
    expect(window.alert).not.toHaveBeenCalled()
  })
})
