import { describe, expect, test } from 'vitest'
import { getAiHomePreset } from '../pages/aiHomePresets.js'

describe('getAiHomePreset', () => {
  test('returns sales preset', () => {
    const preset = getAiHomePreset('sales')
    expect(preset.label).toBe('销售员')
    expect(preset.placeholder).toContain('客户')
    expect(preset.workflows.map((item) => item.key)).toContain('new_project_from_file')
  })

  test('returns pre_sales preset', () => {
    const preset = getAiHomePreset('pre_sales')
    expect(preset.label).toBe('售前顾问')
    expect(preset.systemPrompt).toContain('业务需求及问题')
  })

  test('returns delivery preset', () => {
    const preset = getAiHomePreset('delivery')
    expect(preset.label).toBe('交付顾问')
    expect(preset.workflows.map((item) => item.key)).toContain('pull_pending_requirement_pack')
  })

  test('falls back to pre_sales for unknown role', () => {
    const preset = getAiHomePreset('bad-role')
    expect(preset.key).toBe('pre_sales')
  })

  test('admin preset includes standard governance workflow', () => {
    const preset = getAiHomePreset('admin')
    const workflow = preset.workflows.find((item) => item.key === 'standard_governance')
    expect(workflow).toBeTruthy()
    expect(workflow.title).toContain('标准')
  })
})
