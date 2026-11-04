import { useEffect, useRef, useState } from 'react'

/** Bind async work to this opening, session and target, including A→B→A switches. */
export default function useInvocationScope(open, sessionId, ensureSession) {
  const scope = useRef({ open, sessionId, revision: 0 })
  const target = useRef(0)
  const creating = useRef(null)
  const owned = useRef(null)
  const alive = useRef(false)
  const [, update] = useState(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  if (scope.current.open !== open || scope.current.sessionId !== sessionId) {
    const previous = scope.current
    // ensureSession can update the parent before its promise returns. Verify that ID below.
    const adopting = previous.open && open && !previous.sessionId
      && (creating.current?.revision === previous.revision || owned.current?.sessionId === sessionId)
    scope.current = { open, sessionId, revision: previous.revision + (adopting ? 0 : 1) }
    if (!adopting) { owned.current = null; creating.current = null; target.current += 1 }
  }
  const capture = () => ({ revision: scope.current.revision, target: target.current, sessionId: scope.current.sessionId })
  const current = token => alive.current && scope.current.open && token.revision === scope.current.revision && token.target === target.current
  function invalidate() {
    scope.current.revision += 1
    owned.current = null
    update(value => value + 1)
  }
  async function ensure(name, token) {
    if (!current(token)) return null
    if (owned.current) return owned.current
    if (!scope.current.sessionId) creating.current = token
    try {
      const result = await ensureSession(name)
      if (!current(token)) return null
      if (!result?.sessionId) throw new Error('session_creation_failed')
      if (scope.current.sessionId && scope.current.sessionId !== result.sessionId) {
        invalidate()
        return null
      }
      owned.current = result
      return result
    } catch (error) {
      if (current(token) && !token.sessionId && scope.current.sessionId) invalidate()
      throw error
    } finally {
      if (creating.current === token) creating.current = null
    }
  }
  return { sessionId: scope.current.sessionId ?? owned.current?.sessionId ?? null, revision: scope.current.revision, capture, current, ensure, changeTarget: () => { target.current += 1 } }
}
