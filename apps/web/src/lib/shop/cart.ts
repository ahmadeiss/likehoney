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

/** Read cart from localStorage; safe to call on the client only. */
export function readCart(): CartLine[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((line): line is CartLine =>
        Boolean(
          line &&
          typeof (line as CartLine).variantId === 'string' &&
          typeof (line as CartLine).quantity === 'number',
        ),
      )
      .map((line) => ({
        variantId: line.variantId,
        quantity: Math.max(1, Math.floor(line.quantity)),
      }))
  } catch {
    return []
  }
}

export function writeCart(lines: CartLine[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
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
      return () => window.removeEventListener('lh:cart', onChange)
    },
    () => cartCount(readCart()),
    () => 0,
  )
}
