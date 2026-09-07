'use client'

/**
 * Synchronous, single source of truth for the selected development staff
 * identity (`X-Staff-Id`).
 *
 * The Admin API client resolves the active staff id from this store at request
 * time (see `getCurrentStaffId()`), so the header is always current without any
 * React render-time mutation or parent/child effect ordering. The value is
 * persisted to `localStorage` and is the only authoritative client-side copy.
 *
 * This identity mechanism is DEVELOPMENT-ONLY. Production staff authentication
 * is intentionally unimplemented (see docs).
 */

const STAFF_ID_KEY = 'lh:admin:staff-id'
const STAFF_ID_EVENT = 'lh:admin:staff-id-change'

// In-memory authoritative copy; hydrated once from localStorage on the client.
let currentStaffId: string | null = null
let initialized = false

const listeners = new Set<() => void>()

function readStoredStaffId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(STAFF_ID_KEY)
    return stored && stored.length > 0 ? stored : null
  } catch {
    return null
  }
}

function ensureInitialized(): void {
  if (initialized) return
  initialized = true
  currentStaffId = readStoredStaffId()
  if (typeof window === 'undefined') return
  // Keep the tab in sync when the identity changes in another tab.
  window.addEventListener('storage', (event) => {
    if (event.key !== STAFF_ID_KEY) return
    currentStaffId = event.newValue && event.newValue.length > 0 ? event.newValue : null
    emitChange()
  })
}

function emitChange(): void {
  listeners.forEach((listener) => listener())
}

/**
 * Synchronous read of the current dev staff id. Safe to call from the API
 * client's `apiRequest` immediately before a request.
 */
export function getCurrentStaffId(): string | null {
  ensureInitialized()
  return currentStaffId
}

/**
 * Update and persist the dev staff id (`null` clears it). Notifies React
 * subscriptions synchronously and dispatches the cross-tab change event.
 */
export function setIdentity(id: string | null): void {
  ensureInitialized()
  currentStaffId = id
  if (typeof window !== 'undefined') {
    if (id === null) {
      window.localStorage.removeItem(STAFF_ID_KEY)
    } else {
      window.localStorage.setItem(STAFF_ID_KEY, id)
    }
    window.dispatchEvent(new Event(STAFF_ID_EVENT))
  }
  emitChange()
}

/** Subscription hook for `useSyncExternalStore`. */
export function subscribeIdentity(callback: () => void): () => void {
  ensureInitialized()
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

/** Snapshot read of the current dev staff id for `useSyncExternalStore`. */
export function getIdentitySnapshot(): string | null {
  ensureInitialized()
  return currentStaffId
}

/**
 * Whether the store has synchronized the persisted identity. On the server this
 * is `false`; on the client it becomes `true` synchronously as soon as the store
 * is touched (localStorage is available synchronously during client render).
 */
export function getIdentityReady(): boolean {
  ensureInitialized()
  return initialized
}
