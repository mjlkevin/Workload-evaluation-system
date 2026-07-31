import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import ListPage from '../components/ListPage.jsx'

const rows = [
  { id: 'REV-001', projectName: '第一个项目', status: '待评审' },
  { id: 'REV-002', projectName: '第二个项目', status: '已通过' },
]

function renderListPage() {
  return render(
    <MemoryRouter>
      <ListPage
        crumb="工作台 / 测试列表"
        title="测试列表"
        data={rows}
        rowKey="id"
        bulkActions={[]}
        filterTags={[
          { key: 'all', label: '全部' },
          { key: '待评审', label: '待评审' },
        ]}
        columns={[
          { key: 'id', title: '编号' },
          { key: 'projectName', title: '项目' },
          { key: 'status', title: '状态' },
        ]}
      />
    </MemoryRouter>,
  )
}

describe('ListPage accessibility and selection', () => {
  test('exposes the current filter with aria-pressed', () => {
    renderListPage()

    const allFilter = screen.getByRole('button', { name: '全部' })
    const pendingFilter = screen.getByRole('button', { name: '待评审' })
    expect(allFilter).toHaveAttribute('aria-pressed', 'true')
    expect(pendingFilter).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(pendingFilter)

    expect(allFilter).toHaveAttribute('aria-pressed', 'false')
    expect(pendingFilter).toHaveAttribute('aria-pressed', 'true')
  })

  test('gives the select-all and row checkboxes stable accessible names', () => {
    renderListPage()

    expect(screen.getByRole('checkbox', { name: '选择当前结果' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 REV-001' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 REV-002' })).toBeInTheDocument()
  })

  test('preserves click and shift-range row selection', () => {
    renderListPage()

    fireEvent.click(screen.getByText('第一个项目'))
    expect(screen.getAllByText('已选 1')).toHaveLength(1)

    fireEvent.click(screen.getByText('第二个项目'), { shiftKey: true })
    expect(screen.getByText('已选 2')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 REV-001' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '选择 REV-002' })).toBeChecked()
  })
})
