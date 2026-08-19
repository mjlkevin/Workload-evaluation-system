import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import ListPage from '../components/ListPage.jsx'

const rows = [
  { id: 'REV-001', projectName: '第一个项目', status: '待评审' },
  { id: 'REV-002', projectName: '第二个项目', status: '已通过' },
]

// 前端插批（项一）：15 条数据覆盖「第 13 条可达」缺陷场景
const manyRows = Array.from({ length: 15 }, (_, i) => ({
  id: `REV-${String(i + 1).padStart(3, '0')}`,
  projectName: `项目${i + 1}`,
  status: i % 2 === 0 ? '待评审' : '已通过',
}))

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

function renderManyListPage(props = {}) {
  return render(
    <MemoryRouter>
      <ListPage
        crumb="工作台 / 测试列表"
        title="测试列表"
        data={manyRows}
        rowKey="id"
        bulkActions={[]}
        columns={[
          { key: 'id', title: '编号' },
          { key: 'projectName', title: '项目' },
          { key: 'status', title: '状态' },
        ]}
        {...props}
      />
    </MemoryRouter>,
  )
}

// 前端插批（项一）：去除 12 行硬截断后的分页契约
// - 第 13 条可达（翻页可见）；
// - 总数始终显示（用户知道数据存在）；
// - 四种选择交互（单击 / Cmd-单击 / Shift-范围 / 双击）分页后仍成立；
// - 跨页选择保留（见 ListPage.jsx 文档注释结论）。
describe('ListPage pagination', () => {
  test('第 13 条记录经翻页可达，不再被硬截断', () => {
    renderManyListPage()

    // 第一页可见前 10 条，第 13 条不在第一页
    expect(screen.getByText('项目1')).toBeInTheDocument()
    expect(screen.queryByText('项目13')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    expect(screen.getByText('项目13')).toBeInTheDocument()
    expect(screen.queryByText('项目1')).not.toBeInTheDocument()
  })

  test('总数与当前页范围正确显示', () => {
    renderManyListPage()

    expect(screen.getByText(/共 15 条/)).toBeInTheDocument()
    expect(screen.getByText(/1-10/)).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    expect(screen.getByText(/11-15/)).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    // 尾页禁用下一页
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })

  test('不超过一页的数据不出现翻页按钮但保留总数', () => {
    renderListPage()

    expect(screen.getByText(/共 2 条/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下一页' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '上一页' })).not.toBeInTheDocument()
  })

  test('分页后四种选择交互仍成立（单击 / Cmd-单击 / Shift-范围 / 双击）', () => {
    const opened = []
    renderManyListPage({ onRowClick: (row) => opened.push(row.id) })

    // 单击：单选（清除其他）
    fireEvent.click(screen.getByText('项目2'))
    expect(screen.getByText('已选 1')).toBeInTheDocument()
    fireEvent.click(screen.getByText('项目3'))
    expect(screen.getByText('已选 1')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 REV-002' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: '选择 REV-003' })).toBeChecked()

    // Cmd-单击：toggle 追加
    fireEvent.click(screen.getByText('项目4'), { metaKey: true })
    expect(screen.getByText('已选 2')).toBeInTheDocument()
    fireEvent.click(screen.getByText('项目4'), { metaKey: true })
    expect(screen.getByText('已选 1')).toBeInTheDocument()

    // Shift-单击：锚点区间选择（同页内）——重新单击建立锚点后区间
    fireEvent.click(screen.getByText('项目3'))
    fireEvent.click(screen.getByText('项目7'), { shiftKey: true })
    expect(screen.getByRole('checkbox', { name: '选择 REV-003' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '选择 REV-005' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '选择 REV-007' })).toBeChecked()
    expect(screen.getByText('已选 5')).toBeInTheDocument()

    // 双击：onRowClick 打开
    fireEvent.doubleClick(screen.getByText('项目1'))
    expect(opened).toEqual(['REV-001'])
  })

  test('跨页选择保留：切页不清空已选，工具栏计数跨页累计', () => {
    renderManyListPage()

    fireEvent.click(screen.getByText('项目2'))
    fireEvent.click(screen.getByText('项目3'), { metaKey: true })
    expect(screen.getByText('已选 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    // 切页后选择保留
    expect(screen.getByText('已选 2')).toBeInTheDocument()
    // 第二页以 Cmd-单击追加选择（单击契约为单选清空），计数跨页累计
    fireEvent.click(screen.getByText('项目13'), { metaKey: true })
    expect(screen.getByText('已选 3')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    expect(screen.getByText('已选 3')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 REV-002' })).toBeChecked()
  })

  test('全选只作用于当前页；搜索变化回到第一页', () => {
    renderManyListPage({
      filterTags: [
        { key: 'all', label: '全部' },
        { key: '待评审', label: '待评审' },
      ],
    })

    // 全选当前页（10 条）而非全部 15 条
    fireEvent.click(screen.getByRole('checkbox', { name: '选择当前结果' }))
    expect(screen.getByText('已选 10')).toBeInTheDocument()

    // 切换过滤标签：结果集变化回到第一页
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(screen.getByRole('button', { name: '待评审' }))
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByText(/共 15 条/)).toBeInTheDocument()
  })
})
