'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { readCart, clearCart } from '../../../../lib/shop/cart'
import {
  shopClient,
  formatMoney,
  ApiError,
  newIdempotencyKey,
  type QuoteResponse,
  type PublicDeliveryZoneDoc,
  type PaymentMethod,
} from '../../../../lib/shop/client'
import { copy } from '../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../lib/shop/locale'

/** Maps a backend error code to a customer-facing message. Falls back to a
 *  generic network message for anything not explicitly handled — never a
 *  raw code. */
function errorMessage(err: unknown, t: (typeof copy)['ar']['errors']): string {
  if (!(err instanceof ApiError)) return t.network
  switch (err.code) {
    case 'insufficient_stock':
      return t.insufficientStock
    case 'checkout_totals_changed':
      return t.totalsChanged
    case 'idempotency_conflict':
      return t.idempotencyConflict
    case 'payment_method_disabled':
      return t.paymentMethodDisabled
    case 'payment_provider_not_configured':
    case 'payment_provider_unavailable':
      return t.paymentProviderUnavailable
    case 'payment_reconciliation_pending':
      return t.paymentReconciliationPending
    case 'checkout_unavailable':
      return t.checkoutUnavailable
    case 'validation_error': {
      const details = err.details as { variantId?: string } | undefined
      return details?.variantId ? t.itemNoLongerAvailable : t.validation
    }
    default:
      return t.network
  }
}

export default function CheckoutPage() {
  const router = useRouter()
  const { lang } = useStorefrontLang()
  const t = copy[lang].checkout

  const [quote, setQuote] = useState<QuoteResponse | null>(null)
  const [zones, setZones] = useState<PublicDeliveryZoneDoc[]>([])
  const [selectedZone, setSelectedZone] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod')
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey())

  const [form, setForm] = useState({
    name: '',
    phone: '',
    city: '',
    addressLine1: '',
    addressLine2: '',
    note: '',
    consent: false,
  })

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loadState, setLoadState] = useState<'loading' | 'empty' | 'ready' | 'error'>('loading')
  const quoteRequest = useRef(0)
  const submitLock = useRef(false)

  const cartLines = readCart()

  async function loadQuote(zoneId: string) {
    const request = ++quoteRequest.current
    setQuote(null)
    setError(null)
    setLoadState('loading')
    try {
      const result = await shopClient.verifyCart(zoneId, readCart())
      if (request !== quoteRequest.current) return
      setQuote(result)
      setIdempotencyKey(newIdempotencyKey())
      if (!result.paymentMethods[paymentMethod]) {
        setPaymentMethod(result.paymentMethods.cod ? 'cod' : 'electronic')
      }
      setLoadState('ready')
    } catch (err) {
      if (request !== quoteRequest.current) return
      setError(errorMessage(err, copy[lang].errors))
      setLoadState('error')
    }
  }

  useEffect(() => {
    let cancelled = false
    if (cartLines.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadState('empty')
      return
    }
    shopClient
      .listDeliveryZones()
      .then((zoneResult) => {
        if (cancelled) return
        setZones(zoneResult.data)
        const firstZone = zoneResult.data[0]?.id
        if (!firstZone) {
          setError(copy[lang].errors.checkoutUnavailable)
          setLoadState('error')
          return
        }
        setSelectedZone(firstZone)
        loadQuote(firstZone)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(errorMessage(err, copy[lang].errors))
        setLoadState('error')
      })
    return () => {
      cancelled = true
      quoteRequest.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onZoneChange(zoneId: string) {
    setSelectedZone(zoneId)
    setError(null)
    setLoadState('loading')
    loadQuote(zoneId)
  }

  function onMethodChange(method: PaymentMethod) {
    setPaymentMethod(method)
    setIdempotencyKey(newIdempotencyKey())
  }

  function setField(key: keyof typeof form, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setIdempotencyKey(newIdempotencyKey())
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (
      !quote ||
      submitLock.current ||
      loadState !== 'ready' ||
      quote.deliveryZone.id !== selectedZone ||
      !quote.paymentMethods[paymentMethod]
    )
      return
    submitLock.current = true
    setError(null)
    setSubmitting(true)

    try {
      const order = await shopClient.createOrder({
        idempotencyKey,
        quoteFingerprint: quote.quoteFingerprint,
        paymentMethod,
        deliveryZoneId: selectedZone,
        customer: {
          name: form.name,
          phone: form.phone,
          city: form.city || undefined,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2 || undefined,
          note: form.note || undefined,
          consentToStoreData: form.consent,
        },
        lines: cartLines,
      })

      // The order row exists durably from here on regardless of payment
      // outcome — safe to clear the cart for every response shape.
      clearCart()

      if (order.paymentMethod === 'electronic' && order.redirectUrl) {
        window.location.href = order.redirectUrl
        return
      }
      router.push(`/shop/checkout/success?number=${order.number}`)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'checkout_totals_changed') {
        const fresh = err.details as QuoteResponse | undefined
        if (fresh) {
          setQuote(fresh)
          setIdempotencyKey(newIdempotencyKey())
        }
      }
      setError(errorMessage(err, copy[lang].errors))
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="lh-checkout lh-section">
      <div className="lh-wrap">
        <header className="lh-checkout__head">
          <h1 className="lh-checkout__title">{t.title}</h1>
          <p className="lh-checkout__sub">{t.subtitle}</p>
        </header>

        {error ? (
          <p className="lh-cart__notice" role="alert">
            {error}
          </p>
        ) : null}

        {loadState === 'loading' ? (
          <div className="lh-cart__lines" aria-hidden="true">
            <div className="lh-skel" style={{ height: '6rem' }} />
            <div className="lh-skel" style={{ height: '6rem' }} />
          </div>
        ) : loadState === 'empty' ? (
          <div className="lh-empty">
            <h2 className="lh-empty__title">{copy[lang].cart.emptyTitle}</h2>
            <p className="lh-empty__body">{copy[lang].cart.emptyBody}</p>
          </div>
        ) : loadState === 'error' && !quote ? (
          <div className="lh-empty">
            {selectedZone ? (
              <button
                className="lh-btn lh-btn--secondary"
                type="button"
                onClick={() => void loadQuote(selectedZone)}
              >
                {lang === 'ar' ? 'إعادة المحاولة' : 'Try again'}
              </button>
            ) : (
              <a className="lh-btn lh-btn--secondary" href="/shop/cart">
                {lang === 'ar' ? 'العودة للسلة' : 'Back to cart'}
              </a>
            )}
          </div>
        ) : quote ? (
          <div className="lh-checkout__layout">
            <form className="lh-checkout__form" onSubmit={submit} aria-busy={submitting}>
              <fieldset disabled={submitting} className="lh-checkout__fields">
                <section className="lh-checkout__step">
                  <h2 className="lh-checkout__step-title">{t.stepCustomer}</h2>
                  <div className="lh-field">
                    <label htmlFor="ck-name">{t.name}</label>
                    <input
                      id="ck-name"
                      required
                      autoComplete="name"
                      value={form.name}
                      onChange={(e) => setField('name', e.target.value)}
                    />
                  </div>
                  <div className="lh-field">
                    <label htmlFor="ck-phone">{t.phone}</label>
                    <input
                      id="ck-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      required
                      value={form.phone}
                      onChange={(e) => setField('phone', e.target.value)}
                      placeholder="05XXXXXXXX"
                      dir="ltr"
                    />
                  </div>
                  <div className="lh-field">
                    <label htmlFor="ck-city">{t.city}</label>
                    <input
                      id="ck-city"
                      autoComplete="address-level2"
                      value={form.city}
                      onChange={(e) => setField('city', e.target.value)}
                    />
                  </div>
                  <div className="lh-field">
                    <label htmlFor="ck-addr1">{t.addressLine1}</label>
                    <input
                      id="ck-addr1"
                      autoComplete="street-address"
                      required
                      value={form.addressLine1}
                      onChange={(e) => setField('addressLine1', e.target.value)}
                    />
                  </div>
                  <div className="lh-field">
                    <label htmlFor="ck-addr2">{t.addressLine2}</label>
                    <input
                      id="ck-addr2"
                      value={form.addressLine2}
                      onChange={(e) => setField('addressLine2', e.target.value)}
                    />
                  </div>
                  <div className="lh-field">
                    <label htmlFor="ck-note">{t.note}</label>
                    <textarea
                      id="ck-note"
                      rows={3}
                      value={form.note}
                      onChange={(e) => setField('note', e.target.value)}
                    />
                  </div>
                </section>

                <section className="lh-checkout__step">
                  <h2 className="lh-checkout__step-title">{t.stepDelivery}</h2>
                  <div className="lh-field">
                    <label htmlFor="ck-zone">{t.zone}</label>
                    <select
                      id="ck-zone"
                      required
                      value={selectedZone}
                      onChange={(e) => onZoneChange(e.target.value)}
                    >
                      {zones.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {lang === 'ar' ? zone.nameAr : zone.nameEn} ·{' '}
                          {formatMoney(zone.feeMinor, lang)}
                        </option>
                      ))}
                    </select>
                  </div>
                </section>

                <section className="lh-checkout__step">
                  <h2 className="lh-checkout__step-title">{t.stepPayment}</h2>
                  <div className="lh-checkout__methods">
                    <button
                      type="button"
                      className="lh-checkout__method"
                      aria-pressed={paymentMethod === 'cod'}
                      disabled={!quote.paymentMethods.cod}
                      onClick={() => onMethodChange('cod')}
                    >
                      <span className="lh-checkout__method-title">{t.codLabel}</span>
                      <span className="lh-checkout__method-body">
                        {quote.paymentMethods.cod ? t.codBody : t.methodUnavailable}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="lh-checkout__method"
                      aria-pressed={paymentMethod === 'electronic'}
                      disabled={!quote.paymentMethods.electronic}
                      onClick={() => onMethodChange('electronic')}
                    >
                      <span className="lh-checkout__method-title">{t.methodElectronic}</span>
                      <span className="lh-checkout__method-body">
                        {quote.paymentMethods.electronic
                          ? t.methodElectronicBody
                          : t.methodUnavailable}
                      </span>
                    </button>
                  </div>

                  <label className="lh-checkout__consent">
                    <input
                      type="checkbox"
                      required
                      checked={form.consent}
                      onChange={(e) => setField('consent', e.target.checked)}
                    />
                    <span>{t.consent}</span>
                  </label>
                </section>

                <button
                  type="submit"
                  className="lh-btn lh-btn--primary lh-btn--lg lh-btn--block"
                  disabled={
                    submitting ||
                    !selectedZone ||
                    loadState !== 'ready' ||
                    !quote.paymentMethods[paymentMethod]
                  }
                >
                  {submitting ? t.submitting : t.submit}
                </button>
              </fieldset>

              <p className="lh-checkout__sub" style={{ marginBlockStart: '1rem' }}>
                {t.trustNote}
              </p>
            </form>

            <aside className="lh-cart__summary" aria-label={t.orderSummary}>
              <h2 className="lh-cart__summary-title">{t.stepSummary}</h2>
              {quote.lines.map((line) => (
                <div className="lh-cart__summary-row" key={line.variantId}>
                  <span>
                    {lang === 'ar' ? line.productNameAr : line.productNameEn}
                    {line.variantLabelEn
                      ? ` · ${lang === 'ar' ? line.variantLabelAr : line.variantLabelEn}`
                      : ''}{' '}
                    × {line.quantity}
                  </span>
                  <span className="lh-cart-line__price">
                    {formatMoney(line.lineTotalMinor, lang)}
                  </span>
                </div>
              ))}
              <div className="lh-cart__summary-row">
                <span>{copy[lang].cart.subtotal}</span>
                <span className="lh-cart-line__price">
                  {formatMoney(quote.subtotalMinor, lang)}
                </span>
              </div>
              <div className="lh-cart__summary-row">
                <span>{t.deliveryFee}</span>
                <span className="lh-cart-line__price">
                  {formatMoney(quote.deliveryFeeMinor, lang)}
                </span>
              </div>
              <div className="lh-checkout__total">
                <span>{t.totalLabel}</span>
                <span>{formatMoney(quote.totalMinor, lang)}</span>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  )
}
