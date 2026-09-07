'use client'

import { stockLevelFor } from '@likehoney/shared'
import { Check, Minus, Plus, ShoppingBag } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState, type FormEvent, type ReactElement } from 'react'

import { addToCart } from '../../../../lib/shop/cart'
import { formatMoney } from '../../../../lib/shop/client'
import { copy } from '../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../lib/shop/locale'
import {
  isValueReachable,
  pruneIncompatibleSelection,
  resolveExactVariant,
} from '../../../../lib/shop/variant-selection'

export interface BuyOption {
  id: string
  nameAr: string
  nameEn: string
  values: { id: string; code: string; valueAr: string; valueEn: string }[]
}

export interface BuyVariant {
  id: string
  sku: string
  priceMinor: number
  optionLabelAr: string | null
  optionLabelEn: string | null
  optionValueIds: string[]
  quantityOnHand: number
}

interface ProductBuyProps {
  options: BuyOption[]
  variants: BuyVariant[]
}

/** Customer-facing stock truth only — never the raw on-hand number. */
function stockLabel(
  variant: BuyVariant | undefined,
  t: (typeof copy)['ar']['availability'],
  limitedLabel: string,
): { text: string; tone: 'ok' | 'low' | 'out' } | null {
  if (!variant) return null
  const level = stockLevelFor(variant.quantityOnHand)
  if (level === 'out') return { text: t.outOfStock, tone: 'out' }
  if (level === 'low') return { text: limitedLabel, tone: 'low' }
  return { text: t.inStock, tone: 'ok' }
}

/**
 * Product Detail purchase panel. Renders the real option matrix with the
 * canonical waterfall reachability algorithm, resolves the EXACT variant
 * (never "first match"), shows truthful stock tone, and writes the cart via
 * `addToCart`. A mobile sticky bar mirrors the primary action (CSS-only).
 */
export function ProductBuy({ options, variants }: ProductBuyProps): ReactElement {
  const { lang } = useStorefrontLang()
  const t = copy[lang].product
  const availability = copy[lang].availability

  const [selection, setSelection] = useState<Record<string, string>>({})
  const [quantity, setQuantity] = useState(1)
  const [justAdded, setJustAdded] = useState(false)

  const optionIds = useMemo(() => options.map((o) => o.id), [options])

  const selectedVariant = useMemo(
    () => resolveExactVariant(optionIds, variants, selection),
    [optionIds, variants, selection],
  )

  function choose(optionId: string, valueId: string) {
    setSelection((prev) =>
      pruneIncompatibleSelection(variants, optionIds, { ...prev, [optionId]: valueId }),
    )
  }

  const stock = stockLabel(selectedVariant, availability, t.limitedStock)
  const outOfStock = stock?.tone === 'out'
  const price = selectedVariant?.priceMinor

  function add(event?: FormEvent) {
    event?.preventDefault()
    if (!selectedVariant || outOfStock) return
    addToCart({ variantId: selectedVariant.id, quantity })
    setJustAdded(true)
    window.setTimeout(() => setJustAdded(false), 2200)
  }

  const ctaLabel = justAdded ? (
    <>
      <Check className="lh-btn__icon" aria-hidden="true" /> {t.added}
    </>
  ) : outOfStock ? (
    t.soldOut
  ) : !selectedVariant ? (
    t.selectRequired
  ) : (
    <>
      <ShoppingBag className="lh-btn__icon" aria-hidden="true" />
      {t.addToCart} · {formatMoney(selectedVariant.priceMinor, lang)}
    </>
  )

  return (
    <form onSubmit={add}>
      {options.map((option) => (
        <div key={option.id} className="lh-pdp__option">
          <p className="lh-pdp__option-label">{lang === 'ar' ? option.nameAr : option.nameEn}</p>
          <div
            className="lh-pdp__values"
            role="group"
            aria-label={lang === 'ar' ? option.nameAr : option.nameEn}
          >
            {option.values.map((value) => {
              const reachable = isValueReachable(
                variants,
                optionIds,
                option.id,
                value.id,
                selection,
              )
              return (
                <button
                  type="button"
                  key={value.id}
                  className="lh-pill"
                  aria-pressed={selection[option.id] === value.id}
                  aria-disabled={!reachable}
                  disabled={!reachable}
                  onClick={() => choose(option.id, value.id)}
                >
                  {lang === 'ar' ? value.valueAr : value.valueEn}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="lh-pdp__qty-row">
        <div className="lh-pdp__qty">
          <button
            type="button"
            aria-label={copy[lang].cart.decrease}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          >
            <Minus aria-hidden="true" size={16} />
          </button>
          <output aria-live="polite">{quantity}</output>
          <button
            type="button"
            aria-label={copy[lang].cart.increase}
            onClick={() => setQuantity((q) => q + 1)}
          >
            <Plus aria-hidden="true" size={16} />
          </button>
        </div>

        <label className="lh-pdp__option-label" style={{ margin: 0 }}>
          {t.quantity}
        </label>

        {stock ? (
          <span className={`lh-pdp__stock lh-pdp__stock--${stock.tone}`}>
            <span aria-hidden="true" className="lh-pdp__stock-dot" />
            {stock.text}
          </span>
        ) : null}
      </div>

      <button
        type="submit"
        className="lh-btn lh-btn--primary lh-btn--lg lh-pdp__add"
        disabled={!selectedVariant || outOfStock}
      >
        {ctaLabel}
      </button>

      {justAdded ? (
        <p className="lh-pdp__confirm" role="status">
          {t.added}{' '}
          <Link href="/shop/cart" className="lh-pdp__viewcart">
            {t.viewCart}
          </Link>
        </p>
      ) : null}

      {/* Mobile-only persistent purchase action (sticky bar) — mirrors the
          inline CTA so the primary action stays reachable without scrolling. */}
      <div className="lh-pdp__stickybar">
        <span className="lh-pdp__stickybar__price">
          {price !== undefined ? formatMoney(price, lang) : t.chooseVariant}
        </span>
        <button
          type="submit"
          className="lh-btn lh-btn--primary"
          disabled={!selectedVariant || outOfStock}
        >
          {justAdded ? (
            <>
              <Check className="lh-btn__icon" aria-hidden="true" /> {t.added}
            </>
          ) : outOfStock ? (
            t.soldOut
          ) : (
            <>
              <ShoppingBag className="lh-btn__icon" aria-hidden="true" />
              {t.addShort}
            </>
          )}
        </button>
      </div>
    </form>
  )
}
