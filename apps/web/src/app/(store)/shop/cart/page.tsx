'use client'

import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { readCart, setCartLines, cartCount, type CartLine } from '../../../../lib/shop/cart'
import { shopClient, formatMoney, ApiError, type QuoteLine } from '../../../../lib/shop/client'
import { copy } from '../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../lib/shop/locale'

/**
 * The Cart page only ever needs LINE truth (price/availability) and a
 * subtotal — the real delivery zone is chosen at Checkout. `/cart/verify`
 * requires a `deliveryZoneId` regardless, so this fetches the zone list once
 * and quotes against the first active zone purely as context; only
 * `subtotalMinor` and the per-line truth are shown here (never that zone's
 * delivery fee).
 */
async function verifyAgainstAnyZone(lines: CartLine[]) {
  const zones = await shopClient.listDeliveryZones()
  const zoneId = zones.data[0]?.id
  if (!zoneId) throw new ApiError(0, 'checkout_unavailable', 'no delivery zone configured')
  return shopClient.verifyCart(zoneId, lines)
}

export default function CartPage() {
  const { lang } = useStorefrontLang()
  const t = copy[lang].cart
  const [verified, setVerified] = useState<QuoteLine[] | null>(null)
  const [subtotal, setSubtotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const requestVersion = useRef(0)

  async function reconcile(lines: CartLine[]) {
    const request = ++requestVersion.current
    if (lines.length === 0) {
      setVerified([])
      setSubtotal(0)
      setLoading(false)
      return
    }
    try {
      const result = await verifyAgainstAnyZone(lines)
      if (request !== requestVersion.current) return
      // Truthful reconciliation: adopt the server's per-line reality. A
      // requested quantity above what's actually available is clamped
      // locally and the shopper is told why — never silently overstated.
      let changed = false
      const nextLines: CartLine[] = []
      for (const line of result.lines) {
        const cappedQty = Math.min(line.quantity, Math.max(0, line.availableQuantity))
        if (!line.inStock || cappedQty <= 0) {
          changed = true
          continue
        }
        if (cappedQty !== line.quantity) changed = true
        nextLines.push({ variantId: line.variantId, quantity: cappedQty })
      }
      if (changed) {
        setCartLines(nextLines)
        setNotice(
          nextLines.length < result.lines.length
            ? copy[lang].cart.itemRemoved
            : copy[lang].cart.qtyAdjusted,
        )
        const recheck = nextLines.length > 0 ? await verifyAgainstAnyZone(nextLines) : null
        if (request !== requestVersion.current) return
        setVerified(recheck?.lines ?? [])
        setSubtotal(recheck?.subtotalMinor ?? 0)
      } else {
        setVerified(result.lines)
        setSubtotal(result.subtotalMinor)
      }
      setError(null)
    } catch (err) {
      if (request !== requestVersion.current) return
      if (err instanceof ApiError && err.code === 'validation_error') {
        // A referenced variant no longer resolves at all (deleted/inactive
        // product) — the whole quote fails; the affected line is identified
        // via the error's own `details.variantId` and dropped, then retried.
        const details = err.details as { variantId?: string } | undefined
        if (details?.variantId) {
          const next = readCart().filter((l) => l.variantId !== details.variantId)
          setCartLines(next)
          setNotice(copy[lang].cart.itemRemoved)
          await reconcile(next)
          return
        }
        setError(copy[lang].errors.cartInvalid)
        setVerified([])
      } else {
        setError(copy[lang].errors.network)
      }
    } finally {
      if (request === requestVersion.current) setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    reconcile(readCart()).then(() => {
      if (cancelled) return
    })
    return () => {
      cancelled = true
      requestVersion.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  function removeLine(variantId: string) {
    const next = readCart().filter((line) => line.variantId !== variantId)
    setCartLines(next)
    setNotice(null)
    reconcile(next)
  }

  function changeQuantity(line: QuoteLine, delta: number) {
    const current = readCart()
    const currentQty = current.find((entry) => entry.variantId === line.variantId)?.quantity
    if (currentQty === undefined) return
    const nextQty = Math.min(999, line.availableQuantity, Math.max(1, currentQty + delta))
    if (nextQty === currentQty) return
    const updated = current.map((entry) =>
      entry.variantId === line.variantId ? { ...entry, quantity: nextQty } : entry,
    )
    setCartLines(updated)
    setNotice(null)
    reconcile(updated)
  }

  const count = verified
    ? cartCount(verified.map((l) => ({ variantId: l.variantId, quantity: l.quantity })))
    : 0

  return (
    <div className="lh-cart lh-section">
      <div className="lh-wrap">
        <header className="lh-cart__head">
          <h1 className="lh-cart__title">{t.title}</h1>
          {verified && verified.length > 0 ? (
            <p className="lh-cart__count">
              {count} {count === 1 ? t.count : t.items} {t.inCart}
            </p>
          ) : null}
        </header>

        {notice ? (
          <p className="lh-cart__notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="lh-cart__notice" role="alert">
            {error}
          </p>
        ) : null}

        {loading && !verified ? (
          <div className="lh-cart__lines" aria-hidden="true">
            <div className="lh-skel" style={{ height: '5.5rem' }} />
            <div className="lh-skel" style={{ height: '5.5rem' }} />
          </div>
        ) : verified && verified.length === 0 ? (
          <div className="lh-empty">
            <ShoppingBag className="lh-empty__icon" aria-hidden="true" />
            <h2 className="lh-empty__title">{t.emptyTitle}</h2>
            <p className="lh-empty__body">{t.emptyBody}</p>
            <Link href="/shop" className="lh-btn lh-btn--primary">
              {t.browse}
            </Link>
          </div>
        ) : (
          <div className="lh-cart__layout">
            <div className="lh-cart__lines">
              {verified?.map((line) => (
                <article className="lh-cart-line" key={line.variantId}>
                  <span className="lh-cart-line__thumb" aria-hidden="true" />
                  <div>
                    <h2 className="lh-cart-line__name">
                      {lang === 'ar' ? line.productNameAr : line.productNameEn}
                    </h2>
                    {line.variantLabelEn ? (
                      <p className="lh-cart-line__variant">
                        {lang === 'ar' ? line.variantLabelAr : line.variantLabelEn}
                      </p>
                    ) : null}
                    <div className="lh-cart-line__actions">
                      <span className="lh-card-qty">
                        <button
                          type="button"
                          aria-label={t.decrease}
                          onClick={() => changeQuantity(line, -1)}
                        >
                          <Minus size={14} aria-hidden="true" />
                        </button>
                        <output>{line.quantity}</output>
                        <button
                          type="button"
                          aria-label={t.increase}
                          onClick={() => changeQuantity(line, 1)}
                        >
                          <Plus size={14} aria-hidden="true" />
                        </button>
                      </span>
                      <button
                        type="button"
                        className="lh-cart-line__remove"
                        onClick={() => removeLine(line.variantId)}
                        aria-label={`${t.remove} ${lang === 'ar' ? line.productNameAr : line.productNameEn}`}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        {t.remove}
                      </button>
                    </div>
                  </div>
                  <p className="lh-cart-line__price">{formatMoney(line.lineTotalMinor, lang)}</p>
                </article>
              ))}
            </div>

            <aside className="lh-cart__summary" aria-label={t.summary}>
              <h2 className="lh-cart__summary-title">{t.summary}</h2>
              <div className="lh-cart__summary-row">
                <span>{t.subtotal}</span>
                <span className="lh-cart-line__price">{formatMoney(subtotal, lang)}</span>
              </div>
              <p className="lh-cart__summary-hint">{t.deliveryHint}</p>
              <div className="lh-cart__summary-total">
                <span>{t.subtotal}</span>
                <span>{formatMoney(subtotal, lang)}</span>
              </div>
              <Link
                href="/shop/checkout"
                className="lh-btn lh-btn--primary lh-btn--lg lh-btn--block"
              >
                {t.checkout}
              </Link>
              <Link href="/shop" className="lh-btn lh-btn--ghost lh-btn--block">
                {t.continueShopping}
              </Link>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
