import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import KnowledgeBaseProfilesPanel from '../components/system/KnowledgeBaseProfilesPanel.jsx'

const profile = {
  id: 'treasury', name: '司库与银企知识库', knowledgeId: 'kb-treasury',
  description: '完整的资金与网银知识库说明', routingKeywords: ['资金计划', '网上银行'],
  allowedBusinessRoles: ['pre_sales', 'pm'], enabled: true, isDefault: true, priority: 12,
}
const other = { ...profile, id: 'other', name: '停用知识库', knowledgeId: 'kb-other', description: '停用档案', routingKeywords: [], allowedBusinessRoles: [], enabled: false, isDefault: false }

function renderPanel(props = {}) {
  return render(<KnowledgeBaseProfilesPanel profiles={[profile, other]} onChange={vi.fn()} onTest={vi.fn()} {...props} />)
}

describe('KnowledgeBaseProfilesPanel unified list', () => {
  test('每页十条，搜索涵盖完整档案与角色，启用筛选会重置分页', () => {
    const profiles = Array.from({ length: 12 }, (_, index) => ({ ...profile, id: `p-${index}`, name: `知识库${index + 1}`, knowledgeId: `kb-${index}`, enabled: index !== 11 }))
    renderPanel({ profiles })
    const table = screen.getByRole('table', { name: '知识库档案列表' })
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    expect(screen.queryByText('知识库11')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('知识库12')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '筛选知识库档案' }), { target: { value: 'disabled' } })
    expect(screen.getByText('共 12 条（筛选后 1 条） · 显示 1-1')).toBeInTheDocument()
    expect(screen.getByText('知识库12')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索知识库档案' }), { target: { value: 'kb-11' } })
    expect(screen.getByText('知识库12')).toBeInTheDocument()
    expect(screen.queryByText('知识库1')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '项目经理' } })
    expect(screen.getByText('共 12 条（筛选后 12 条） · 显示 1-10')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '未配置的关键词' } })
    expect(screen.getByText('没有匹配的知识库档案')).toBeInTheDocument()
  })

  test('查看详情保留所有档案字段和验证记录，关闭恢复查看入口焦点', async () => {
    const onChange = vi.fn()
    renderPanel({ onChange, probes: { treasury: { status: 'success', checkedAt: '2026-10-21T02:00:00.000Z', latencyMs: 88, warning: 'retrieval_empty', errorCode: 'probe-error', providerCode: 200, providerMessage: '供应商信息', providerRequestId: 'request-1', configHash: 'hash-1' } } })
    expect(screen.getByText('资金计划 · 网上银行')).toBeInTheDocument()
    expect(screen.getByText('售前顾问 · 项目经理')).toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: `查看 ${profile.name}` })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: `知识库详情：${profile.name}` })
    for (const value of [profile.name, profile.id, profile.knowledgeId, profile.description, '资金计划 · 网上银行', '售前顾问 · 项目经理', '已启用', '是', '12', '已验证', '2026-10-21T02:00:00.000Z', '88 ms', 'retrieval_empty', 'probe-error', '200', '供应商信息', 'request-1', 'hash-1']) {
      expect(within(dialog).getByText(value)).toBeInTheDocument()
    }
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭', exact: true }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  test.each(['取消', '关闭编辑知识库', 'Escape', 'backdrop'])('%s 不会静默丢弃未保存的档案，也不会调用 onChange', (method) => {
    const onChange = vi.fn()
    renderPanel({ onChange })
    fireEvent.click(screen.getByRole('button', { name: `编辑 ${profile.name}` }))
    const dialog = screen.getByRole('dialog', { name: '编辑知识库' })
    fireEvent.change(within(dialog).getByLabelText('知识库名称'), { target: { value: '临时修改' } })
    expect(onChange).not.toHaveBeenCalled()
    if (method === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' })
    else if (method === 'backdrop') fireEvent.click(dialog.closest('.wes-dialog-backdrop'))
    else fireEvent.click(within(dialog).getByRole('button', { name: method, exact: true }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('尚未应用')
    fireEvent.click(within(dialog).getByRole('button', { name: '继续编辑' }))
    expect(within(dialog).getByLabelText('知识库名称')).toHaveValue('临时修改')
    fireEvent.click(within(dialog).getByRole('button', { name: '取消', exact: true }))
    fireEvent.click(within(dialog).getByRole('button', { name: '放弃修改' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: `编辑 ${profile.name}` }))
    expect(screen.getByLabelText('知识库名称')).toHaveValue(profile.name)
  })

  test('保存后才回填所有档案字段，并且默认库保持唯一', () => {
    const onChange = vi.fn()
    renderPanel({ onChange })
    fireEvent.click(screen.getByRole('button', { name: `编辑 ${other.name}` }))
    const dialog = screen.getByRole('dialog', { name: '编辑知识库' })
    fireEvent.change(within(dialog).getByLabelText('说明'), { target: { value: '新的说明' } })
    fireEvent.change(within(dialog).getByLabelText('优先级'), { target: { value: '22' } })
    fireEvent.change(within(dialog).getByLabelText('路由关键词'), { target: { value: '采购， 采购\n库存' } })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '销售', exact: true }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '启用知识库' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '设为安全默认库' }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '保存档案' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const updated = onChange.mock.calls[0][0]
    expect(updated[0].isDefault).toBe(false)
    expect(updated[1]).toEqual({ ...other, description: '新的说明', priority: 22, routingKeywords: ['采购', '库存'], allowedBusinessRoles: ['sales'], enabled: true, isDefault: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test.each([['内部标识', 'treasury'], ['知识库 ID', 'kb-treasury']])('新增档案阻止重复%s并保留候选值', (label, value) => {
    const onChange = vi.fn()
    renderPanel({ onChange })
    fireEvent.click(screen.getByRole('button', { name: '新增知识库' }))
    fireEvent.change(screen.getByLabelText('知识库名称'), { target: { value: '重复档案' } })
    fireEvent.change(screen.getByLabelText('内部标识'), { target: { value: 'new-id' } })
    fireEvent.change(screen.getByLabelText('知识库 ID'), { target: { value: 'kb-new' } })
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: '保存档案' }))
    expect(screen.getByRole('alert')).toHaveTextContent('内部标识或知识库 ID 已存在')
    expect(screen.getByLabelText(label)).toHaveValue(value)
    expect(onChange).not.toHaveBeenCalled()
  })

  test('测试调用精确档案，停用和测试中保持操作限制，查看仍然可用', () => {
    const onTest = vi.fn()
    const view = renderPanel({ onTest })
    fireEvent.click(screen.getByRole('button', { name: `测试 ${profile.name}` }))
    expect(onTest).toHaveBeenCalledWith(profile.id)
    expect(screen.getByRole('button', { name: `测试 ${other.name}` })).toBeDisabled()
    view.rerender(<KnowledgeBaseProfilesPanel profiles={[profile, other]} testingProfileId={profile.id} disabled onTest={onTest} />)
    expect(screen.getByRole('button', { name: '测试中...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: `编辑 ${profile.name}` })).toBeDisabled()
    expect(screen.getByRole('button', { name: '新增知识库' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: `查看 ${other.name}` }))
    expect(screen.getByRole('dialog', { name: `知识库详情：${other.name}` })).toBeInTheDocument()
  })
})
