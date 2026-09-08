/**
 * Client-held cart for guest checkout (V1).
 *
 * The browser owns the cart snapshot in `localStorage`; the server never trusts
 * its numbers. On render with items, the UI calls the public `/cart/verify`
 * endpoint so the server authoritatively re-resolves active variant/price/shape
 * and surfaces out-of-stock. Checkout likewise verifies before ordering.
 */

import { useSyncExternalStore } from 'react'

export interface CartLine {
  variantId: string
  quantity: number
}

export interface CartLineDetail extends CartLine {
  productId: string
  sku: string
  nameAr: string
  nameEn: string
  variantLabelAr: string | null
  variantLabelEn: string | null
  unitPriceMinor: number
  quantityOnHand: number
}

const STORAGE_KEY = 'lh:cart'
let memoryCart: CartLine[] = []
let storageUnavailable = false

/** Discard corrupt storage and merge duplicate variants before quoting. */
export function normalizeCart(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return []
  const lines = new Map<string, number>()
  for (const line of value) {
    if (
      typeof line !== 'object' ||
      line === null ||
      !('variantId' in line) ||
      !('quantity' in line)
    )
      continue
    if (
      typeof line.variantId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line.variantId) ||
      typeof line.quantity !== 'number' ||
      !Number.isFinite(line.quantity) ||
      line.quantity < 1
    )
      continue
    lines.set(
      line.variantId,
      Math.min(999, (lines.get(line.variantId) ?? 0) + Math.floor(line.quantity)),
    )
  }
  return Array.from(lines, ([variantId, quantity]) => ({ variantId, quantity }))
}

/** Read cart from localStorage; safe to call on the client only. */
export function readCart(): CartLine[] {
  if (typeof window === 'undefined') return []
  if (storageUnavailable) return memoryCart.map((line) => ({ ...line }))
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    memoryCart = raw ? normalizeCart(JSON.parse(raw) as unknown) : []
    return memoryCart.map((line) => ({ ...line }))
  } catch {
    storageUnavailable = true
    return memoryCart.map((line) => ({ ...line }))
  }
}

export function writeCart(lines: CartLine[]): void {
  if (typeof window === 'undefined') return
  memoryCart = normalizeCart(lines)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryCart))
    storageUnavailable = false
  } catch {
    storageUnavailable = true
    // Browsers that deny storage can still shop within the current tab.
  }
  window.dispatchEvent(new CustomEvent('lh:cart'))
}

export function addToCart(line: CartLine): void {
  const current = readCart()
  const existing = current.find((entry) => entry.variantId === line.variantId)
  if (existing) existing.quantity = Math.min(existing.quantity + line.quantity, 999)
  else current.push({ variantId: line.variantId, quantity: line.quantity })
  writeCart(current)
}

export function setCartLines(lines: CartLine[]): void {
  writeCart(lines)
}

export function clearCart(): void {
  writeCart([])
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0)
}

/**
 * Reactive item count, SSR-safe. Subscribes to the `lh:cart` custom event so the
 * header badge stays in sync with any cart mutation without effect-driven state.
 */
export function useCartCount(): number {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('lh:cart', onChange)
      const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY || event.key === null) onChange()
      }
      window.addEventListener('storage', onStorage)
      return () => {
        window.removeEventListener('lh:cart', onChange)
        window.removeEventListener('storage', onStorage)
      }
    },
    () => cartCount(readCart()),
    () => 0,
  )
}
