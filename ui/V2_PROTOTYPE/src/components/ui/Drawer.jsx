import { useEffect, useId, useRef } from 'react'

function isTabbable(element) {
  if (element.tabIndex < 0 || element.matches(':disabled')) return false
  if (element instanceof HTMLInputElement && element.type === 'hidden') return false

  for (let current = element; current instanceof HTMLElement; current = current.parentElement) {
    if (current.hidden || current.hasAttribute('inert')) return false
    const style = window.getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }

  return true
}

function getFocusableElements(container) {
  return [...container.querySelectorAll('*')]
    .filter(isTabbable)
}

export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  closeOnBackdrop = true,
  initialFocusRef,
  blocked = false,
}) {
  const titleId = useId()
  const descriptionId = useId()
  const surfaceRef = useRef(null)
  const openerRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const blockedRef = useRef(blocked)
  onCloseRef.current = onClose
  blockedRef.current = blocked

  useEffect(() => {
    if (!open) return undefined

    const surface = surfaceRef.current
    const previousOverflow = document.body.style.overflow
    openerRef.current = document.activeElement
    document.body.style.overflow = 'hidden'

    const focusTarget = initialFocusRef?.current
      || getFocusableElements(surface)[0]
      || surface
    focusTarget?.focus()

    const handleKeyDown = (event) => {
      if (event.defaultPrevented) return
      if (blockedRef.current) return

      const eventModal = event.target instanceof Element
        ? event.target.closest('[aria-modal="true"]')
        : null
      if (eventModal && eventModal !== surface) return

      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current?.()
        return
      }

      if (event.key !== 'Tab') return

      const focusable = getFocusableElements(surface)
      if (focusable.length === 0) {
        event.preventDefault()
        surface?.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (!surface?.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (openerRef.current?.isConnected) {
        openerRef.current.focus()
      }
    }
  }, [initialFocusRef, open])

  if (!open) return null

  const handleBackdropClick = (event) => {
    if (!blockedRef.current && closeOnBackdrop && event.target === event.currentTarget) {
      onCloseRef.current?.()
    }
  }

  return (
    <div className="wes-drawer-backdrop" onClick={handleBackdropClick}>
      <aside
        ref={surfaceRef}
        className="wes-drawer"
        role="dialog"
        aria-modal={blocked ? undefined : 'true'}
        aria-hidden={blocked ? 'true' : undefined}
        inert={blocked ? '' : undefined}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="wes-drawer__header">
          <div className="wes-drawer__heading">
            <h2 className="wes-drawer__title" id={titleId}>{title}</h2>
            {description ? (
              <p className="wes-drawer__description" id={descriptionId}>{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="wes-drawer__close"
            aria-label={`关闭${title}`}
            disabled={blocked}
            onClick={() => {
              if (!blockedRef.current) onCloseRef.current?.()
            }}
          >
            ×
          </button>
        </header>
        <div className="wes-drawer__body">{children}</div>
        {footer ? <footer className="wes-drawer__footer">{footer}</footer> : null}
      </aside>
    </div>
  )
}
