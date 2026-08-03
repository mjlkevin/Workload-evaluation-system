import { createContext, useCallback, useContext, useRef, useState } from 'react'

const ToastContext = createContext(null)

let toastIdCounter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef(new Map())

  const removeToast = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const addToast = useCallback((toast) => {
    const id = ++toastIdCounter
    const kind = toast.kind || 'info'
    const duration = toast.duration ?? (kind === 'error' ? 6000 : 3000)
    const detail = toast.detail || null

    setToasts((current) => [...current, { id, kind, message: toast.message, detail }])

    if (duration > 0) {
      const timer = setTimeout(() => removeToast(id), duration)
      timersRef.current.set(id, timer)
    }

    return id
  }, [removeToast])

  const toast = useCallback((message, options = {}) => {
    if (typeof message === 'string') {
      return addToast({ message, ...options })
    }
    return addToast(message)
  }, [addToast])

  const success = useCallback((message, options = {}) => {
    return addToast({ message, kind: 'success', ...options })
  }, [addToast])

  const error = useCallback((message, options = {}) => {
    return addToast({ message, kind: 'error', ...options })
  }, [addToast])

  const warn = useCallback((message, options = {}) => {
    return addToast({ message, kind: 'warn', ...options })
  }, [addToast])

  const info = useCallback((message, options = {}) => {
    return addToast({ message, kind: 'info', ...options })
  }, [addToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, toast, success, error, warn, info }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}

export default useToast
