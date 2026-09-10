'use client'

/**
 * Live "orders needing attention" count for Admin — one lightweight aggregate
 * (`GET /orders/status-counts`, never the orders list), shared by every badge
 * surface (sidebar, mobile drawer, queue tab) through a tiny external store so
 * there is exactly ONE poller per session no matter how many components read it.
 *
 * Freshness strategy (no WebSockets/SSE, per V1):
 *  - immediate first read,
 *  - light polling (10s) while the tab is visible, paused while hidden,
 *  - immediate refetch on window focus / tab return,
 *  - immediate refetch when the existing `bumpOrders()` channel fires (any
 *    order transition anywhere in the session),
 *  - quiet bounded backoff (10s → … → cap 30s) on transient failure, keeping
 *    the last-known-good count so the badge never flickers away.
 */
import { useSyncExternalStore } from 'react'

import { client } from './client'
import { subscribeOrders } from './revalidate'

export interface OrderCountState {
  /** false until the first successful read — badges stay hidden (neutral). */
  ready: boolean
  /** Orders awaiting preparation. Last-known-good survives transient errors. */
  processing: number
}

const BASE_POLL_MS = 10_000
const MAX_POLL_MS = 30_000

let state: OrderCountState = { ready: false, processing: 0 }
let pollMs = BASE_POLL_MS
let started = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

async function refresh(): Promise<void> {
  try {
    const counts = await client.orderStatusCounts()
    pollMs = BASE_POLL_MS
    state = { ready: true, processing: counts.processing }
    emit()
  } catch {
    // Transient failure — stretch the next poll, keep the last-known-good.
    pollMs = Math.min(pollMs * 1.5, MAX_POLL_MS)
  }
}

function schedulePoll(): void {
  window.setTimeout(() => {
    if (document.visibilityState === 'visible') void refresh()
    schedulePoll()
  }, pollMs)
}

/** Lazily start the single session-wide poller + listeners. */
function start(): void {
  if (started) return
  started = true
  if (typeof window === 'undefined') return
  void refresh()
  schedulePoll()
  window.addEventListener('focus', () => void refresh())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh()
  })
  subscribeOrders(() => void refresh())
}

function subscribeOrderCount(onChange: () => void): () => void {
  listeners.add(onChange)
  start()
  return () => {
    listeners.delete(onChange)
  }
}

function getOrderCountSnapshot(): OrderCountState {
  return state
}

/** Reactive order-badge state (external store — one poller, many readers). */
export function useActionableOrderCount(): OrderCountState {
  return useSyncExternalStore(subscribeOrderCount, getOrderCountSnapshot, getOrderCountSnapshot)
}

/** "0" → "0", "7" → "7", "1 200" → "99+" — stable badge geometry. */
export function formatBadgeCount(n: number): string {
  return n > 99 ? '99+' : String(n)
}

/** True when the badge should be shown (has data AND something to show). */
export function shouldShowOrderBadge(value: OrderCountState): boolean {
  return value.ready && value.processing > 0
}
