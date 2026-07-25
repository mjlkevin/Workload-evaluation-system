import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, test } from 'vitest'
import { Drawer } from '../components/ui/Drawer.jsx'

function DrawerHarness({ closeOnBackdrop = true }) {
  const [open, setOpen] = useState(false)
  const roleSelectRef = useRef(null)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>编辑 arch</button>
      <Drawer
        open={open}
        title="编辑用户"
        description="arch"
        closeOnBackdrop={closeOnBackdrop}
        initialFocusRef={roleSelectRef}
        onClose={() => setOpen(false)}
        footer={<button type="button">保存变更</button>}
      >
        <label>
          系统角色
          <select ref={roleSelectRef} defaultValue="user">
            <option value="admin">管理员</option>
            <option value="user">普通用户</option>
          </select>
        </label>
        <button type="button">重置密码</button>
      </Drawer>
    </>
  )
}

describe('Drawer', () => {
  test('opens with modal semantics, associations, close button, and initial focus', async () => {
    render(<DrawerHarness />)
    fireEvent.click(screen.getByRole('button', { name: '编辑 arch' }))

    const drawer = screen.getByRole('dialog', { name: '编辑用户' })
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(document.getElementById(drawer.getAttribute('aria-labelledby'))).toHaveTextContent('编辑用户')
    expect(document.getElementById(drawer.getAttribute('aria-describedby'))).toHaveTextContent('arch')
    expect(screen.getByRole('button', { name: '关闭编辑用户' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('系统角色')).toHaveFocus())
  })

  test('closes on Escape, unmounts, and restores focus to the opener', async () => {
    render(<DrawerHarness />)
    const opener = screen.getByRole('button', { name: '编辑 arch' })
    fireEvent.click(opener)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  test('honors backdrop close policy and wraps Tab focus in both directions', () => {
    const { rerender } = render(<DrawerHarness closeOnBackdrop={false} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑 arch' }))

    const drawer = screen.getByRole('dialog')
    const first = screen.getByRole('button', { name: '关闭编辑用户' })
    const last = screen.getByRole('button', { name: '保存变更' })
    fireEvent.click(drawer.parentElement)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    last.focus()
    fireEvent.keyDown(drawer, { key: 'Tab' })
    expect(first).toHaveFocus()

    first.focus()
    fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()

    rerender(<DrawerHarness closeOnBackdrop />)
    fireEvent.click(screen.getByRole('dialog').parentElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
