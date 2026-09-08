'use client'

import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'

import { addToCart } from '../../../../lib/shop/cart'
import {
  ApiError,
  formatMoney,
  shopClient,
  type PublicProductDetail,
} from '../../../../lib/shop/client'
import { copy } from '../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../lib/shop/locale'
import {
  isValueReachable,
  pruneIncompatibleSelection,
  resolveExactVariant,
} from '../../../../lib/shop/variant-selection'

/**
 * Lazy-fetched option picker — opened only when a shopper taps "choose
 * option" on a card. Fetches exactly one product's real detail, renders its
 * real options/variants, and resolves the EXACT real variant from the
 * selections — never a guessed combination. Bottom sheet on mobile, a
 * centered compact panel on desktop (same markup, CSS repositions it).
 */
export function OptionSheet({
  productId,
  onClose,
}: {
  productId: string
  onClose: () => void
}): ReactElement {
  const { lang, isAr } = useStorefrontLang()
  const t = copy[lang]
  const [detail, setDetail] = useState<PublicProductDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Record<string, string>>({})
  const [added, setAdded] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    shopClient
      .getProduct(productId)
      .then((res) => {
        if (cancelled) return
        setDetail(res)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof ApiError ? t.errors.loadFailed : t.errors.network)
      })
    return () => {
      cancelled = true
    }
  }, [productId, t.errors.loadFailed, t.errors.network])

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const buttons = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [],
      )
    buttons()[0]?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab') return
      const items = buttons()
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
    }
  }, [onClose])

  const optionIds = useMemo(() => (detail ? detail.options.map((o) => o.id) : []), [detail])

  const resolvedVariant = useMemo(() => {
    if (!detail) return null
    return resolveExactVariant(optionIds, detail.variants, selection) ?? null
  }, [detail, optionIds, selection])

  function choose(optionId: string, valueId: string) {
    if (!detail) return
    setSelection((prev) =>
      pruneIncompatibleSelection(detail.variants, optionIds, { ...prev, [optionId]: valueId }),
    )
  }

  const complete = detail ? detail.options.length === 0 || resolvedVariant !== null : false
  const available = resolvedVariant ? resolvedVariant.quantityOnHand > 0 : false

  const submit = () => {
    if (!resolvedVariant || !available) return
    addToCart({ variantId: resolvedVariant.id, quantity: 1 })
    setAdded(true)
    window.setTimeout(onClose, 700)
  }

  const name = detail ? (isAr ? detail.nameAr : detail.nameEn) : ''
  const price = resolvedVariant ? resolvedVariant.priceMinor : (detail?.priceFromMinor ?? 0)

  return (
    <>
      <div className="lh-sheet__scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="lh-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label={t.sheet.title}
      >
        <div className="lh-sheet__handle" aria-hidden="true" />
        <div className="lh-sheet__head">
          <h2 className="lh-sheet__title" style={{ margin: 0 }}>
            {name || t.sheet.title}
          </h2>
          <button
            type="button"
            className="lh-icon-btn"
            onClick={onClose}
            aria-label={t.sheet.close}
          >
            <X className="lh-icon-btn__svg" aria-hidden="true" />
          </button>
        </div>

        {error ? (
          <p className="lh-sheet__error">{error}</p>
        ) : !detail ? (
          <div className="lh-sheet__loading">
            <div className="lh-skel" style={{ height: '1.25rem', width: '70%' }} />
            <div className="lh-skel" style={{ height: '2.25rem', width: '100%' }} />
            <div className="lh-skel" style={{ height: '2.25rem', width: '100%' }} />
          </div>
        ) : (
          <>
            {detail.options.map((option) => (
              <div className="lh-sheet__option" key={option.id}>
                <p className="lh-sheet__label">{isAr ? option.nameAr : option.nameEn}</p>
                <div className="lh-sheet__values">
                  {option.values.map((value) => {
                    const reachable = isValueReachable(
                      detail.variants,
                      optionIds,
                      option.id,
                      value.id,
                      selection,
                    )
                    return (
                      <button
                        key={value.id}
                        type="button"
                        className="lh-pill"
                        aria-pressed={selection[option.id] === value.id}
                        aria-disabled={!reachable}
                        disabled={!reachable}
                        onClick={() => choose(option.id, value.id)}
                      >
                        {isAr ? value.valueAr : value.valueEn}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            <div className="lh-sheet__footer">
              <div>
                <p className="lh-sheet__price">{formatMoney(price, lang)}</p>
                <p className="lh-sheet__status">
                  {complete
                    ? available
                      ? t.sheet.availability
                      : t.card.outOfStock
                    : t.product.selectRequired}
                </p>
              </div>
              <button
                type="button"
                className="lh-btn lh-btn--primary"
                disabled={!complete || !available}
                onClick={submit}
              >
                {added ? t.product.added : t.card.add}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
