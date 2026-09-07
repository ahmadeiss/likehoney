'use client'

/**
 * Real staff authentication state for the Admin area.
 *
 * The browser authenticates with a server-side session cookie (`lh_staff_session`,
 * HttpOnly + Secure + SameSite). The cookie is carried automatically on
 * same-origin requests; this provider resolves the signed-in staff member +
 * permissions via `GET /auth/me` and keeps a small client-side state machine
 * (`checking | authenticated | anonymous`). No role or identity claim stored
 * client-side is ever treated as authoritative — the backend re-checks
 * active status + RBAC on every request.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { ApiError, client, type AuthMeDoc } from './client'
import { subscribeIdentity } from './identity-store'

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous'

interface AuthContextValue {
  status: AuthStatus
  me: AuthMeDoc | null
  /** True while the initial session resolution is still in flight. */
  checking: boolean
  refresh: () => Promise<void>
  login: (identifier: string, password: string) => Promise<AuthMeDoc>
  logout: () => Promise<void>
  hasPermission: (code: string) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AuthMeDoc | null>(null)
  const [status, setStatus] = useState<AuthStatus>('checking')
  const resolveRef = useRef<number>(0)

  const resolve = useCallback(async (): Promise<void> => {
    const attempt = ++resolveRef.current
    try {
      const resolved = await client.me()
      if (attempt !== resolveRef.current) return
      setMe(resolved)
      setStatus('authenticated')
    } catch (cause) {
      if (attempt !== resolveRef.current) return
      // 401 means anonymous; any other error also lands on the sign-in screen
      // (the user can try again), never a partial/fraudulent state.
      setMe(null)
      setStatus('anonymous')
      if (cause instanceof ApiError && cause.status === 500) {
        // Surface nothing here; the login page handles messaging.
      }
    }
  }, [])

  useEffect(() => {
    const attempt = ++resolveRef.current
    let cancelled = false
    // Async callbacks only — resolves the session on mount without a
    // synchronous setState inside the effect body (which the session status is
    // derived from the server, an external system).
    client.me().then(
      (resolved) => {
        if (cancelled || attempt !== resolveRef.current) return
        setMe(resolved)
        setStatus('authenticated')
      },
      () => {
        if (cancelled || attempt !== resolveRef.current) return
        // 401 means anonymous; any other error also lands on the sign-in screen
        // (the user can try again), never a partial/fraudulent state.
        setMe(null)
        setStatus('anonymous')
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  // Development identity picker: when the selected dev staff id changes there is
  // no session event to react to, so re-resolve `/auth/me` — which honors the
  // `X-Staff-Id` header on a dev/loopback host — to pick up the newly selected
  // staff member's real permissions. In production the dev id is never set, so
  // this subscription never fires a refetch.
  useEffect(() => subscribeIdentity(() => void resolve()), [resolve])

  const login = useCallback(async (identifier: string, password: string): Promise<AuthMeDoc> => {
    const resolved = await client.login(identifier, password)
    setMe(resolved)
    setStatus('authenticated')
    return resolved
  }, [])

  const logout = useCallback(async (): Promise<void> => {
    try {
      await client.logout()
    } catch {
      // Best-effort server revocation; the cookie is cleared regardless.
    }
    setMe(null)
    setStatus('anonymous')
  }, [])

  const hasPermission = useCallback(
    (code: string): boolean => (me ? me.permissions.includes(code) : false),
    [me],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      checking: status === 'checking',
      refresh: () => resolve(),
      login,
      logout,
      hasPermission,
    }),
    [status, me, resolve, login, logout, hasPermission],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (ctx === null) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
