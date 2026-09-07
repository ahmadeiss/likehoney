'use client'

/**
 * The smallest shared Admin revalidation signal.
 *
 * Every admin page fetches through `useResource`, which re-runs its loader on
 * mount and whenever its deps change — so *navigating* between pages already
 * yields fresh data (client fetches are never cached; see `apiRequest`'s
 * `cache: 'no-store'`). What this module adds is *same-session* coherence: a
 * successful catalog/inventory mutation bumps a version counter, and any live
 * `useResource` that opted into `{ revalidate: true }` refetches immediately —
 * no `router.refresh()`, no `window.location.reload()`, no manual F5.
 *
 * `catalog` covers products, variants, inventory balances and everything
 * derived from them (readiness, dashboard stock/attention, store-sale search).
 */
let version = 0
const listeners = new Set<() => void>()

/** Call after any mutation that changes catalog/inventory/sellability state. */
export function bumpCatalog(): void {
  version += 1
  for (const listener of listeners) listener()
}

export function subscribeCatalog(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

export function getCatalogVersion(): number {
  return version
}

// ---------------------------------------------------------------------------
// Orders — a separate channel so an order lifecycle transition on the detail
// screen moves the row between queues on a live list (and vice versa) without
// a manual refresh. A cancellation that restocks also fires `bumpCatalog()`.
// ---------------------------------------------------------------------------

const orderListeners = new Set<() => void>()

export function bumpOrders(): void {
  for (const listener of orderListeners) listener()
}

export function subscribeOrders(callback: () => void): () => void {
  orderListeners.add(callback)
  return () => {
    orderListeners.delete(callback)
  }
}
