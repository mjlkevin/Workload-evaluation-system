import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import {
  afterEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'
import { Dialog, DialogActions } from '../components/ui/Dialog.jsx'
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

function ProgrammaticDrawerHarness() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const openDrawer = () => setOpen(true)
    document.addEventListener('open-programmatic-drawer', openDrawer)
    return () => document.removeEventListener('open-programmatic-drawer', openDrawer)
  }, [])

  return (
    <>
      <button type="button">陈旧目标</button>
      <Drawer
        open={open}
        title="编辑用户"
        onClose={() => setOpen(false)}
      >
        <button type="button">重置密码</button>
      </Drawer>
    </>
  )
}

function TabbableControlsHarness() {
  return (
    <Drawer open title="编辑用户" onClose={() => {}}>
      <button type="button">有效控件</button>
      <input aria-label="忽略的输入" tabIndex={-1} />
      <button type="button" disabled tabIndex={0}>禁用控件</button>
    </Drawer>
  )
}

function StackedModalHarness() {
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(true)

  return (
    <>
      <Drawer
        open={drawerOpen}
        title="编辑用户"
        onClose={() => setDrawerOpen(false)}
      >
        <button type="button">侧栏操作</button>
      </Drawer>
      <Dialog
        open={dialogOpen}
        title="确认操作"
        onClose={() => setDialogOpen(false)}
      >
        <label>
          确认备注
          <input />
        </label>
        <DialogActions>
          <button type="button">取消确认</button>
          <button type="button">确认保存</button>
        </DialogActions>
      </Dialog>
    </>
  )
}

function disableDrawerClose(node) {
  const drawer = node?.closest('[role="dialog"]')
  const closeButton = drawer?.querySelector('button[aria-label^="关闭"]')
  if (closeButton) closeButton.disabled = true
}

function ActualTabbabilityHarness() {
  return (
    <Drawer open title="编辑用户" onClose={() => {}}>
      <span ref={disableDrawerClose}>只读说明</span>
      <input type="hidden" />
      <fieldset disabled>
        <input aria-label="禁用字段" />
      </fieldset>
      <div hidden>
        <button type="button">隐藏属性控件</button>
      </div>
      <div inert="">
        <button type="button">惰性控件</button>
      </div>
      <div style={{ display: 'none' }}>
        <button type="button">不显示控件</button>
      </div>
      <div style={{ visibility: 'hidden' }}>
        <button type="button">不可见控件</button>
      </div>
      <button type="button" tabIndex={-2}>负序控件</button>
      <button type="button">有效控件一</button>
      <button type="button">有效控件二</button>
    </Drawer>
  )
}

function NoControlsHarness() {
  return (
    <Drawer open title="编辑用户" onClose={() => {}}>
      <span ref={disableDrawerClose}>无可操作内容</span>
    </Drawer>
  )
}

function DisconnectedOpenerHarness() {
  const [open, setOpen] = useState(false)
  const [showOpener, setShowOpener] = useState(true)

  return (
    <>
      {showOpener ? (
        <button type="button" onClick={() => setOpen(true)}>打开侧栏</button>
      ) : null}
      <Drawer open={open} title="编辑用户" onClose={() => setOpen(false)}>
        <button type="button" onClick={() => setShowOpener(false)}>移除触发器</button>
      </Drawer>
    </>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

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
    opener.focus()
    fireEvent.click(opener)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  test('restores the active body when a drawer opens programmatically', async () => {
    render(<ProgrammaticDrawerHarness />)
    fireEvent.click(screen.getByRole('button', { name: '陈旧目标' }))
    document.body.focus()

    fireEvent(document, new Event('open-programmatic-drawer'))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.body).toHaveFocus()
    expect(screen.getByRole('button', { name: '陈旧目标' })).not.toHaveFocus()
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

  test('skips tabindex-negative and disabled controls when trapping focus', () => {
    render(<TabbableControlsHarness />)
    const drawer = screen.getByRole('dialog')
    const closeButton = screen.getByRole('button', { name: '关闭编辑用户' })
    const validControl = screen.getByRole('button', { name: '有效控件' })

    validControl.focus()
    fireEvent.keyDown(drawer, { key: 'Tab' })
    expect(closeButton).toHaveFocus()

    closeButton.focus()
    fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true })
    expect(validControl).toHaveFocus()
  })

  test('leaves fallback Dialog in sole control of Escape above the Drawer', async () => {
    vi.stubGlobal('HTMLDialogElement', undefined)
    render(<StackedModalHarness />)
    const topDialog = screen.getByRole('dialog', { name: '确认操作' })
    expect(topDialog.tagName).toBe('DIV')

    fireEvent.keyDown(topDialog, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认操作' })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()
  })

  test('does not steal Tab or Shift+Tab from a fallback Dialog above the Drawer', () => {
    vi.stubGlobal('HTMLDialogElement', undefined)
    render(<StackedModalHarness />)
    const topDialog = screen.getByRole('dialog', { name: '确认操作' })
    const first = screen.getByRole('button', { name: '关闭确认操作' })
    const last = screen.getByRole('button', { name: '确认保存' })

    last.focus()
    fireEvent.keyDown(topDialog, { key: 'Tab' })
    expect(first).toHaveFocus()

    first.focus()
    fireEvent.keyDown(topDialog, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  test('ignores keyboard events already handled by another owner', () => {
    render(<DrawerHarness />)
    fireEvent.click(screen.getByRole('button', { name: '编辑 arch' }))
    const drawer = screen.getByRole('dialog')
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    event.preventDefault()

    fireEvent(drawer, event)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('uses only actually tabbable controls for initial focus and wrapping', async () => {
    render(<ActualTabbabilityHarness />)
    const drawer = screen.getByRole('dialog')
    const first = screen.getByRole('button', { name: '有效控件一' })
    const last = screen.getByRole('button', { name: '有效控件二' })
    await waitFor(() => expect(first).toHaveFocus())

    last.focus()
    fireEvent.keyDown(drawer, { key: 'Tab' })
    expect(first).toHaveFocus()

    first.focus()
    fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  test('locks body scrolling and restores the previous overflow value', () => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'clip'

    try {
      render(<DrawerHarness />)
      const opener = screen.getByRole('button', { name: '编辑 arch' })
      opener.focus()
      fireEvent.click(opener)
      expect(document.body.style.overflow).toBe('hidden')

      fireEvent.click(screen.getByRole('button', { name: '关闭编辑用户' }))
      expect(document.body.style.overflow).toBe('clip')
    } finally {
      const closeButton = screen.queryByRole('button', { name: '关闭编辑用户' })
      if (closeButton) fireEvent.click(closeButton)
      document.body.style.overflow = originalOverflow
    }
  })

  test('focuses the surface when no enabled controls remain', () => {
    render(<NoControlsHarness />)
    const drawer = screen.getByRole('dialog')
    expect(drawer).toHaveFocus()

    fireEvent.keyDown(drawer, { key: 'Tab' })
    expect(drawer).toHaveFocus()
  })

  test('does not restore focus to an opener removed while the Drawer is open', async () => {
    render(<DisconnectedOpenerHarness />)
    const opener = screen.getByRole('button', { name: '打开侧栏' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: '移除触发器' }))
    expect(screen.queryByRole('button', { name: '打开侧栏' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭编辑用户' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.body).toHaveFocus()
  })
})
