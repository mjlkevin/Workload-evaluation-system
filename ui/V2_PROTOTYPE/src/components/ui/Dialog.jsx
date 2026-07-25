import {
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

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

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  wide = false,
  closeOnBackdrop = true,
  initialFocusRef,
}) {
  const titleId = useId()
  const descriptionId = useId()
  const surfaceRef = useRef(null)
  const openerRef = useRef(null)
  const lastInteractionRef = useRef(null)
  const dragRef = useRef(null)
  const [translation, setTranslation] = useState({ x: 0, y: 0 })
  const supportsNativeDialog = (
    typeof HTMLDialogElement !== 'undefined'
    && typeof HTMLDialogElement.prototype.showModal === 'function'
  )

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
    openerRef.current = document.activeElement === document.body
      ? lastInteractionRef.current
      : document.activeElement

    if (supportsNativeDialog && surface && !surface.open) {
      surface.showModal()
    }

    const focusTarget = initialFocusRef?.current
      || getFocusableElements(surface.querySelector('.wes-dialog__body'))[0]
      || surface
    focusTarget?.focus()

    return () => {
      if (supportsNativeDialog && surface?.open) {
        surface.close()
      }
      setTranslation({ x: 0, y: 0 })
      dragRef.current = null
      if (openerRef.current?.isConnected) {
        openerRef.current.focus()
      }
    }
  }, [initialFocusRef, open, supportsNativeDialog])

  if (!open) return null

  const requestClose = () => {
    onClose?.()
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      requestClose()
      return
    }

    if (event.key !== 'Tab') return

    const focusable = getFocusableElements(surfaceRef.current)
    if (focusable.length === 0) {
      event.preventDefault()
      surfaceRef.current?.focus()
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
    } else if (!surfaceRef.current?.contains(document.activeElement)) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleBackdropClick = (event) => {
    if (event.target === event.currentTarget && closeOnBackdrop) {
      requestClose()
    }
  }

  const handlePointerDown = (event) => {
    if (event.button !== 0) return
    if (event.target.closest('button, a, input, select, textarea, [role="button"]')) return

    const surface = surfaceRef.current
    const rect = surface.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: translation.x,
      originY: translation.y,
      minX: translation.x - rect.left,
      maxX: translation.x + window.innerWidth - rect.right,
      minY: translation.y - rect.top,
      maxY: translation.y + window.innerHeight - rect.bottom,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const nextX = drag.originX + event.clientX - drag.startX
    const nextY = drag.originY + event.clientY - drag.startY
    setTranslation({
      x: Math.min(drag.maxX, Math.max(drag.minX, nextX)),
      y: Math.min(drag.maxY, Math.max(drag.minY, nextY)),
    })
  }

  const handlePointerEnd = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    dragRef.current = null
  }

  const surfaceProps = {
    ref: surfaceRef,
    className: `wes-dialog${wide ? ' wes-dialog--wide' : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    'aria-describedby': description ? descriptionId : undefined,
    tabIndex: -1,
    style: {
      transform: `translate(${translation.x}px, ${translation.y}px)`,
    },
    onKeyDown: handleKeyDown,
    onClick: supportsNativeDialog ? handleBackdropClick : undefined,
  }

  const content = (
    <>
      <header
        className="wes-dialog__header"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <div>
          <h2 className="wes-dialog__title" id={titleId}>{title}</h2>
          {description ? (
            <p className="wes-dialog__description" id={descriptionId}>{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="wes-dialog__close"
          aria-label={`关闭${title}`}
          onClick={requestClose}
        >
          ×
        </button>
      </header>
      <div className="wes-dialog__body">{children}</div>
    </>
  )

  return (
    <div className="wes-dialog-backdrop" onClick={handleBackdropClick}>
      {supportsNativeDialog ? (
        <dialog
          {...surfaceProps}
          onCancel={(event) => {
            event.preventDefault()
            requestClose()
          }}
        >
          {content}
        </dialog>
      ) : (
        <div {...surfaceProps}>{content}</div>
      )}
    </div>
  )
}

export function DialogActions({ children }) {
  return <div className="wes-dialog__actions">{children}</div>
}
