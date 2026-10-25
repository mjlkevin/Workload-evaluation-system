import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import SystemObjectList from '../components/system/SystemObjectList.jsx'

const rows = Array.from({ length: 12 }, (_, index) => ({ id: index, name: `对象 ${index + 1}`, enabled: index % 2 === 0 }))
const columns = [{ key: 'name', label: '名称', render: (row) => row.name }]
const filters = [{ value: 'enabled', label: '已启用', matches: (row) => row.enabled }]

describe('SystemObjectList', () => {
  test('所有记录可分页到达，筛选和搜索缩小结果时回到有效页', () => {
    render(<SystemObjectList title="测试对象" rows={rows} columns={columns} filters={filters} searchText={(row) => row.name} />)
    const table = screen.getByRole('table', { name: '测试对象列表' })
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    expect(within(table).queryByText('对象 11')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(within(table).getByText('对象 12')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '筛选测试对象' }), { target: { value: 'enabled' } })
    expect(within(table).getAllByRole('row')).toHaveLength(7)
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索测试对象' }), { target: { value: '对象 11' } })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索测试对象' }), { target: { value: '不存在' } })
    expect(screen.getByText('没有匹配的测试对象')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }))
    expect(screen.getByRole('searchbox', { name: '搜索测试对象' })).toHaveValue('')
    expect(within(screen.getByRole('table')).getByText('对象 1')).toBeInTheDocument()
  })

  test('加载、失败和空数据分开显示，不把旧记录或零条当作加载结果', () => {
    const retry = vi.fn()
    const { rerender } = render(<SystemObjectList title="测试对象" rows={rows} columns={columns} loading />)
    expect(screen.getByText('正在加载测试对象…')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    rerender(<SystemObjectList title="测试对象" rows={rows} columns={columns} error="读取失败" onRetry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('读取失败')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    rerender(<SystemObjectList title="测试对象" rows={[]} columns={columns} />)
    expect(screen.getByText('暂无测试对象')).toBeInTheDocument()
  })
})
