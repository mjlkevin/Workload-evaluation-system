import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { Dialog, DialogActions } from '../components/ui/Dialog.jsx'

function DialogHarness({ description, closeOnBackdrop = true }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开配置</button>
      <Dialog
        open={open}
        title="配置编码规则"
        description={description}
        closeOnBackdrop={closeOnBackdrop}
        onClose={() => setOpen(false)}
      >
        <label>
          前缀
          <input />
        </label>
        <DialogActions>
          <button type="button" onClick={() => setOpen(false)}>取消</button>
          <button type="button">保存</button>
        </DialogActions>
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  test('associates title and description and focuses the first control', async () => {
    render(<DialogHarness description="修改会影响后续编码" />)
    fireEvent.click(screen.getByRole('button', { name: '打开配置' }))
    const dialog = screen.getByRole('dialog', { name: '配置编码规则' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby'))).toHaveTextContent('配置编码规则')
    expect(document.getElementById(dialog.getAttribute('aria-describedby'))).toHaveTextContent('修改会影响后续编码')
    expect(screen.getByRole('button', { name: '关闭配置编码规则' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('前缀')).toHaveFocus())
  })

  test('closes on Escape and restores focus to the opener', async () => {
    render(<DialogHarness />)
    const opener = screen.getByRole('button', { name: '打开配置' })
    fireEvent.click(opener)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  test('honors the backdrop close policy', () => {
    const { rerender } = render(<DialogHarness closeOnBackdrop />)
    fireEvent.click(screen.getByRole('button', { name: '打开配置' }))
    fireEvent.click(screen.getByRole('dialog').parentElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(<DialogHarness closeOnBackdrop={false} />)
    fireEvent.click(screen.getByRole('button', { name: '打开配置' }))
    fireEvent.click(screen.getByRole('dialog').parentElement)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('traps Tab within the fallback dialog', () => {
    render(<DialogHarness />)
    fireEvent.click(screen.getByRole('button', { name: '打开配置' }))
    const first = screen.getByRole('button', { name: '关闭配置编码规则' })
    const last = screen.getByRole('button', { name: '保存' })

    last.focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
    expect(first).toHaveFocus()

    first.focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  test('clamps title dragging to the viewport', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600)
    render(<DialogHarness />)
    fireEvent.click(screen.getByRole('button', { name: '打开配置' }))

    const dialog = screen.getByRole('dialog')
    const handle = dialog.querySelector('.wes-dialog__header')
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 500,
      bottom: 400,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: 150,
      clientY: 120,
    })
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 2000,
      clientY: 2000,
    })

    expect(dialog).toHaveStyle({ transform: 'translate(300px, 200px)' })
  })
})
