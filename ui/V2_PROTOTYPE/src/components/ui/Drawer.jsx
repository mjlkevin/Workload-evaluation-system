import { useEffect, useId, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusableElements(container) {
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
    .filter((element) => !element.hasAttribute('hidden'))
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
}) {
  const titleId = useId()
  const descriptionId = useId()
  const surfaceRef = useRef(null)
  const openerRef = useRef(null)
  const lastInteractionRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (open) return undefined

    const rememberClickTarget = (event) => {
      if (event.target instanceof HTMLElement) {
        lastInteractionRef.current = event.target
      }
    }
    document.addEventListener('click', rememberClickTarget, true)
    return () => document.removeEventListener('click', rememberClickTarget, true)
  }, [open])

  useEffect(() => {
    if (!open) return undefined

    const surface = surfaceRef.current
    const previousOverflow = document.body.style.overflow
    openerRef.current = document.activeElement === document.body
      ? lastInteractionRef.current
      : document.activeElement
    document.body.style.overflow = 'hidden'

    const focusTarget = initialFocusRef?.current
      || getFocusableElements(surface)[0]
      || surface
    focusTarget?.focus()

    const handleKeyDown = (event) => {
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
    if (closeOnBackdrop && event.target === event.currentTarget) {
      onCloseRef.current?.()
    }
  }

  return (
    <div className="wes-drawer-backdrop" onClick={handleBackdropClick}>
      <aside
        ref={surfaceRef}
        className="wes-drawer"
        role="dialog"
        aria-modal="true"
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
            onClick={onClose}
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
