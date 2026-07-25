import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import SystemManagement from '../pages/SystemManagement.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

function renderSection(sectionId = 'rules') {
  return render(
    <MemoryRouter>
      <SystemManagement sectionId={sectionId} />
    </MemoryRouter>
  )
}

describe('SystemManagement shared dialogs', () => {
  test('closes prompt management from the shared close button and restores focus', async () => {
    renderSection()
    const trigger = screen.getByRole('button', { name: '✎ 提示词' })

    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: '提示词管理' })
    expect(dialog).toHaveClass('wes-dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭提示词管理' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '提示词管理' })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  test('cancels the first model editor without saving', async () => {
    let saveCalls = 0
    server.use(
      http.patch(`${BASE}/system/requirement-settings/draft`, () => {
        saveCalls += 1
        return HttpResponse.json({ success: true, data: { version: 2 } })
      })
    )
    renderSection('model')

    const editButtons = await screen.findAllByRole('button', { name: '编辑' })
    fireEvent.click(editButtons[0])
    const dialog = await screen.findByRole('dialog', { name: '编辑 KIMI 评估' })
    expect(dialog).toHaveClass('wes-dialog', 'wes-dialog--wide')
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑 KIMI 评估' })).not.toBeInTheDocument())
    expect(saveCalls).toBe(0)
  })

  test('uses the shared wide dialog for a new manual test result', async () => {
    renderSection('testResults')
    const trigger = await screen.findByRole('button', { name: '+ 新建' })

    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: '新建人工测试结果' })
    expect(dialog).toHaveClass('wes-dialog', 'wes-dialog--wide')
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建人工测试结果' })).not.toBeInTheDocument())
  })
})
