'use client'

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

import {
  getIdentityReady,
  getIdentitySnapshot,
  setIdentity,
  subscribeIdentity,
} from './identity-store'
import { useAuth } from './auth'

const SERVER_SNAPSHOT: string | null = null
const SERVER_READY = false

interface IdentityContextValue {
  /** The selected DEVELOPMENT staff id (optional; empty with a real session). */
  staffId: string | null
  /**
   * Whether an effective identity is available to drive protected fetches —
   * true when a real session is active OR a dev identity is selected.
   */
  hasIdentity: boolean
  /**
   * Whether the effective identity state is known (auth resolved on the client
   * or the persisted dev id is synchronized).
   */
  identityReady: boolean
  setStaffId: (id: string | null) => void
}

const IdentityContext = createContext<IdentityContextValue | null>(null)

/**
 * React-facing identity surface. Combines the real auth session (server cookie)
 * with the development identity picker: an "effective identity" exists when a
 * signed-in session is active, otherwise when a dev identity is selected. This
 * provider performs no side effects during render — it only reads the
 * synchronous identity store and the auth context.
 */
export function IdentityProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const devStaffId = useSyncExternalStore(
    subscribeIdentity,
    getIdentitySnapshot,
    () => SERVER_SNAPSHOT,
  )
  const devReady = useSyncExternalStore(subscribeIdentity, getIdentityReady, () => SERVER_READY)

  // A real session makes the identity effective at once; the dev hydration is
  // also considered but never replaces the session as the server authority.
  const identityReady = !auth.checking || devReady
  const hasIdentity = auth.status === 'authenticated' || devStaffId !== null

  const setStaffId = useCallback((id: string | null) => {
    setIdentity(id)
  }, [])

  const value = useMemo<IdentityContextValue>(
    () => ({
      staffId: devStaffId,
      hasIdentity,
      identityReady,
      setStaffId,
    }),
    [devStaffId, hasIdentity, identityReady, setStaffId],
  )

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
}

export function useIdentity(): IdentityContextValue {
  const ctx = useContext(IdentityContext)
  if (ctx === null) throw new Error('useIdentity must be used within IdentityProvider')
  return ctx
}
