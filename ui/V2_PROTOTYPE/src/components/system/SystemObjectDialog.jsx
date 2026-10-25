import { useEffect, useState } from 'react'
import { Dialog, DialogActions } from '../ui/Dialog.jsx'
import { systemButton } from './SystemObjectList.jsx'

export default function SystemObjectDialog({ open, title, description, onClose, dirty = false, busy = false, initialFocusRef, fallbackFocusRef, children, footer }) {
  const [discard, setDiscard] = useState(false)
  useEffect(() => { if (!open) setDiscard(false) }, [open])
  useEffect(() => {
    if (!open) return undefined
    return () => {
      // Let Dialog restore its opener first. A filtered-out row needs a live fallback.
      queueMicrotask(() => { if (document.activeElement === document.body) fallbackFocusRef?.current?.focus() })
    }
  }, [open, fallbackFocusRef])
  const requestClose = () => {
    if (busy) return
    if (dirty) setDiscard(true)
    else onClose()
  }
  return (
    <Dialog open={open} title={title} description={description} wide onClose={requestClose} dismissDisabled={busy} initialFocusRef={initialFocusRef}>
      {children}
      {discard && <div role="alert" className="mt-4 rounded-md border border-solid border-warn/30 bg-warn-soft p-3 text-sm leading-6 text-warn-ink">有尚未应用的修改，确定放弃吗？</div>}
      <DialogActions>
        {discard ? <><button type="button" className={systemButton} onClick={() => setDiscard(false)}>继续编辑</button><button type="button" className={`${systemButton} text-err-ink`} onClick={onClose}>放弃修改</button></> : (typeof footer === 'function' ? footer(requestClose) : footer) || <button type="button" className={systemButton} onClick={requestClose}>关闭</button>}
      </DialogActions>
    </Dialog>
  )
}

export function SystemObjectFacts({ items }) {
  return <dl className="m-0 grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">{items.map(({ label, value }) => <div key={label} className="min-w-0"><dt className="mb-1 text-xs font-medium leading-5 text-ink-2">{label}</dt><dd className="m-0 text-sm leading-6 text-ink wrap-anywhere">{value ?? '—'}</dd></div>)}</dl>
}
