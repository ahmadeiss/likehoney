'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronLeft, ShoppingBag } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactElement } from 'react'

import { cartCount, useCartLines } from '../../../../lib/shop/cart'
import { dockUnits, isProductDetailRoute, shouldShowCartDock } from '../../../../lib/shop/cart-dock'
import { formatMoney, quoteAgainstAnyZone } from '../../../../lib/shop/client'
import { copy } from '../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../lib/shop/locale'

/**
 * Persistent cart dock — the premium "browse with your cart" summary bar.
 *
 * Pinned to the bottom on every storefront route except the cart/checkout/
 * success stages themselves. It always shows the REAL client cart snapshot
 * (total unit quantity, same/cross-tab reactive) and, when the server quote
 * resolves, the authoritative subtotal via the same `/cart/verify` path the
 * Cart page uses — the dock never derives prices client-side and never mutates
 * the cart (reconciliation happens on the Cart page itself).
 *
 * The whole bar is a single link to the cart. No auto-open, no auto-scroll.
 * A fixed-height in-flow spacer sits after the footer so the dock never
 * permanently obscures footer content; it collapses the moment the dock hides
 * (or immediately when the user prefers reduced motion).
 */
export function CartDock(): ReactElement {
  const pathname = usePathname()
  const lines = useCartLines()
  const { lang } = useStorefrontLang()
  const t = copy[lang].dock
  const reduceMotion = useReducedMotion()

  const show = shouldShowCartDock(pathname)
  const pdp = isProductDetailRoute(pathname)
  const count = cartCount(lines)
  const visible = show && lines.length > 0

  // Server-authoritative subtotal, debounced and non-mutating. The resolved
  // amount is stored keyed to the exact cart it was quoted for; render derives
  // the shown value, so an old amount is never displayed against new
  // quantities. A failed quote keeps the last-known-good amount for the same
  // cart and otherwise simply resolves to the neutral dash.
  const cartKey = lines.map((line) => `${line.variantId}:${line.quantity}`).join('|')
  const [quoteResult, setQuoteResult] = useState<{ lines: string; subtotalMinor: number } | null>(
    null,
  )
  const quoteSlug = useRef(0)
  const subtotal =
    quoteResult !== null && quoteResult.lines === cartKey ? quoteResult.subtotalMinor : null

  useEffect(() => {
    if (lines.length === 0) return
    const slug = ++quoteSlug.current
    const key = cartKey
    const timer = window.setTimeout(() => {
      quoteAgainstAnyZone(lines)
        .then((quote) => {
          if (slug === quoteSlug.current)
            setQuoteResult({ lines: key, subtotalMinor: quote.subtotalMinor })
        })
        .catch(() => {
          // Transient failure: keep last-known-good for the same key.
        })
    }, 220)
    return () => window.clearTimeout(timer)
  }, [lines, cartKey])

  const units = dockUnits(count, t.count, t.items)
  const dockLabel = `${t.viewCart}: ${count} ${units}`

  return (
    <>
      <AnimatePresence>
        {visible ? (
          <motion.aside
            key="lh-dock"
            className={`lh-cart-dock${pdp ? ' lh-cart-dock--pdp' : ''}`}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
            transition={{
              duration: reduceMotion ? 0.01 : 0.28,
              ease: [0.22, 1, 0.36, 1] as const,
            }}
          >
            <Link href="/shop/cart" className="lh-cart-dock__link" aria-label={dockLabel}>
              <span className="lh-cart-dock__icon" aria-hidden="true">
                <ShoppingBag size={18} strokeWidth={2.1} />
                <span key={count} className="lh-cart-dock__pill">
                  {count}
                </span>
              </span>

              <span className="lh-cart-dock__summary" aria-hidden="true">
                <span className="lh-cart-dock__units">
                  {count} {units}
                </span>
                {subtotal !== null ? (
                  <span className="lh-cart-dock__subtotal">
                    <span>{t.subtotal}</span>
                    <span>{formatMoney(subtotal, lang)}</span>
                  </span>
                ) : (
                  <span className="lh-cart-dock__dash">—</span>
                )}
              </span>

              <span className="lh-cart-dock__cta" aria-hidden="true">
                {t.viewCart}
                <ChevronLeft className="lh-cart-dock__arrow" size={16} strokeWidth={2.2} />
              </span>
            </Link>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <div
        aria-hidden="true"
        className={`lh-cart-dock__reserve${visible ? ' lh-cart-dock__reserve--on' : ''}${visible && pdp ? ' lh-cart-dock__reserve--on--pdp' : ''}`}
      />
    </>
  )
}
