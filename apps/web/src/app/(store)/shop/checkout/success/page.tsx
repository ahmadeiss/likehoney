'use client'

import { Check, Clock, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState, type ReactElement } from 'react'

import { shopClient, formatMoney } from '../../../../../lib/shop/client'
import type { PublicOrderDoc } from '../../../../../lib/shop/client'
import { copy } from '../../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../../lib/shop/locale'

/**
 * Derives the customer-facing state from the order's own real
 * `paymentMethod`/`paymentStatus` — never from a browser return/callback,
 * and never presented as "paid" unless the order truly is.
 */
function resolveState(order: PublicOrderDoc): 'cod' | 'paid' | 'pending' | 'expired' {
  if (order.paymentMethod === 'cod') return 'cod'
  if (order.paymentStatus === 'paid') return 'paid'
  if (order.status === 'cancelled') return 'expired'
  return 'pending'
}

function SuccessInner(): ReactElement {
  const { lang } = useStorefrontLang()
  const t = copy[lang].success
  const searchParams = useSearchParams()
  const number = searchParams.get('number') ?? undefined
  const [order, setOrder] = useState<PublicOrderDoc | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!number) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoaded(true)
      return
    }
    let cancelled = false
    shopClient
      .getOrder(number)
      .then((data) => {
        if (!cancelled) setOrder(data)
      })
      .catch(() => {
        if (!cancelled) setOrder(null)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [number])

  if (!loaded) {
    return (
      <div className="lh-success" aria-busy="true">
        <div
          className="lh-skel"
          style={{ height: '3.5rem', width: '3.5rem', borderRadius: '50%', marginInline: 'auto' }}
        />
        <p className="lh-success__body">{t.loading}</p>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="lh-success">
        <p className="lh-success__title">{copy[lang].errors.loadFailed}</p>
        <Link
          href="/shop"
          className="lh-btn lh-btn--primary"
          style={{ marginBlockStart: '1.5rem' }}
        >
          {t.browse}
        </Link>
      </div>
    )
  }

  const state = resolveState(order)
  const heading =
    state === 'paid'
      ? t.electronicPaidTitle
      : state === 'pending'
        ? t.electronicPendingTitle
        : state === 'expired'
          ? t.electronicExpiredTitle
          : t.title
  const body =
    state === 'paid'
      ? t.electronicPaidBody
      : state === 'pending'
        ? t.electronicPendingBody
        : state === 'expired'
          ? t.electronicExpiredBody
          : t.subtitle
  const iconTone = state === 'expired' ? 'expired' : state === 'pending' ? 'pending' : 'ok'

  return (
    <div className="lh-success">
      <div className={`lh-success__icon lh-success__icon--${iconTone}`} aria-hidden="true">
        {state === 'expired' ? <XCircle /> : state === 'pending' ? <Clock /> : <Check />}
      </div>
      <h1 className="lh-success__title">{heading}</h1>
      <p className="lh-success__body">{body}</p>

      <dl className="lh-success__details">
        <div className="lh-success__row">
          <dt>{t.orderNumber}</dt>
          <dd className="lh-cart-line__price">{order.number}</dd>
        </div>
        <div className="lh-success__row">
          <dt>{t.payment}</dt>
          <dd>{order.paymentMethod === 'cod' ? t.codLabel : t.methodElectronic}</dd>
        </div>
        {order.items.map((item) => (
          <div className="lh-success__row" key={item.sku}>
            <dt>
              {lang === 'ar' ? item.productNameAr : item.productNameEn} × {item.quantity}
            </dt>
            <dd className="lh-cart-line__price">{formatMoney(item.lineTotalMinor, lang)}</dd>
          </div>
        ))}
        <div className="lh-success__row lh-success__row--total">
          <dt>{t.total}</dt>
          <dd>{formatMoney(order.totalMinor, lang)}</dd>
        </div>
      </dl>

      <Link
        href="/shop"
        className="lh-btn lh-btn--primary lh-btn--lg"
        style={{ marginBlockStart: '1.5rem' }}
      >
        {t.browse}
      </Link>
    </div>
  )
}

export default function SuccessPage(): ReactElement {
  return (
    <div className="lh-section">
      <div className="lh-wrap">
        <Suspense fallback={<div className="lh-skel" style={{ height: '20rem' }} />}>
          <SuccessInner />
        </Suspense>
      </div>
    </div>
  )
}
