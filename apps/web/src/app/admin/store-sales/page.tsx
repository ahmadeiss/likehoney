'use client'

import {
  ChevronLeft,
  Minus,
  Plus,
  Receipt,
  ScanBarcode,
  Search,
  ShoppingCart,
  Trash2,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { Button, Dialog, Field, Input, Select } from '@likehoney/ui'

import {
  client,
  type CustomerCard,
  type StoreSaleCreateResult,
  type StoreSaleProductHit,
  type StoreSaleVariantHit,
} from '../../../lib/admin/client'
import { useResource } from '../../../lib/admin/hooks'
import { subscribeCatalog } from '../../../lib/admin/revalidate'
import { useAuth } from '../../../lib/admin/auth'
import { useLocale, useT } from '../../../lib/admin/i18n'
import { formatCount, formatPhone, formatPrice, formatRelative } from '../../../lib/admin/format'
import {
  AdminEmpty,
  AdminPage,
  CustomerCardView,
  CustomerReturningBadge,
  DEFAULT_PAGE_SIZE,
  ErrorState,
  Flash,
  PageHeader,
  Pagination,
  Panel,
  RowSkeleton,
  SearchField,
  SectionHead,
  Toolbar,
} from '../_components/shared'

function monogram(name: string): string {
  const clean = name.trim()
  return clean.length === 0 ? '·' : Array.from(clean).slice(0, 2).join('').toUpperCase()
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminStoreSalesPage() {
  const t = useT()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<'register' | 'history'>(
    searchParams.get('sale') ? 'history' : 'register',
  )

  return (
    <AdminPage width="wide">
      <PageHeader
        title={t('storeSales.title')}
        description={t('storeSales.description')}
        actions={
          <div
            className="flex gap-0.5 rounded-lg border border-border bg-surface p-0.5"
            role="tablist"
            aria-label={t('storeSales.title')}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'register'}
              className={`lh-admin-hub-tab${tab === 'register' ? ' lh-admin-hub-tab--active' : ''}`}
              onClick={() => setTab('register')}
            >
              <ScanBarcode size={15} aria-hidden="true" />
              {t('storeSales.tabRegister')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'history'}
              className={`lh-admin-hub-tab${tab === 'history' ? ' lh-admin-hub-tab--active' : ''}`}
              onClick={() => setTab('history')}
            >
              <Receipt size={15} aria-hidden="true" />
              {t('storeSales.tabHistory')}
            </button>
          </div>
        }
      />

      {tab === 'register' ? <RegisterView /> : <HistoryView />}
    </AdminPage>
  )
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

interface BasketLine {
  variantId: string
  productId: string
  productNameAr: string
  sku: string
  optionLabel: string
  unitPriceMinor: number
  quantity: number
  maxQty: number
}

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return v
}

function RegisterView() {
  const t = useT()
  const locale = useLocale()
  const { hasPermission } = useAuth()
  const canSell = hasPermission('store-sales:write')

  const [query, setQuery] = useState('')
  const debounced = useDebounced(query.trim())
  const [results, setResults] = useState<StoreSaleProductHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)

  const [selected, setSelected] = useState<StoreSaleProductHit | null>(null)
  const [basket, setBasket] = useState<BasketLine[]>([])
  const [note, setNote] = useState('')
  const [extra, setExtra] = useState(false)
  // Phone-first POS customer capture (§14-§17).
  const [withCustomer, setWithCustomer] = useState(false)
  const [phone, setPhone] = useState('')
  const [custName, setCustName] = useState('')
  const [custCity, setCustCity] = useState('')
  const [custAddress, setCustAddress] = useState('')
  const [custMatch, setCustMatch] = useState<CustomerCard | null>(null)
  const [custLookupError, setCustLookupError] = useState(false)
  const debouncedPhone = useDebounced(phone.trim(), 400)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [done, setDone] = useState<StoreSaleCreateResult | null>(null)
  const [detailFor, setDetailFor] = useState<string | null>(null)

  // State is only ever set from async callbacks; the "term too short" case is
  // handled at render time (`shownResults`). `catalogTick` re-runs the search
  // when a catalog/inventory mutation lands, so a product that just became
  // sellable (or unsellable) appears/disappears here with no manual refresh.
  const [catalogTick, setCatalogTick] = useState(0)
  useEffect(() => subscribeCatalog(() => setCatalogTick((n) => n + 1)), [])

  useEffect(() => {
    if (debounced.length < 2) return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setSearching(true)
    })
    client
      .searchStoreSaleProducts(debounced, 8)
      .then((hits) => {
        if (!cancelled) {
          setResults(hits)
          setSearchError(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResults([])
          setSearchError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced, catalogTick])

  // Phone-first lookup: as the operator types a phone, show a match + prefill
  // if the customer already exists, otherwise leave the fields empty for a new
  // one. Never blocks the sale — it's a convenience, not a gate.
  useEffect(() => {
    let cancelled = false
    if (!withCustomer || debouncedPhone.length < 6) {
      queueMicrotask(() => {
        if (!cancelled) setCustMatch(null)
      })
      return () => {
        cancelled = true
      }
    }
    client
      .lookupStoreSaleCustomer(debouncedPhone)
      .then((res) => {
        if (cancelled) return
        setCustLookupError(false)
        if (res.found && res.customer) {
          setCustMatch(res.customer)
          setCustName(
            (locale === 'ar' ? res.customer.nameAr : res.customer.nameEn) ??
              res.customer.nameAr ??
              res.customer.nameEn ??
              '',
          )
          setCustCity(
            (locale === 'ar' ? res.customer.cityAr : res.customer.cityEn) ??
              res.customer.cityAr ??
              '',
          )
          setCustAddress(
            (locale === 'ar' ? res.customer.addressAr : res.customer.addressEn) ??
              res.customer.addressAr ??
              '',
          )
        } else {
          setCustMatch(null)
        }
      })
      .catch(() => {
        if (!cancelled) setCustLookupError(true)
      })
    return () => {
      cancelled = true
    }
  }, [withCustomer, debouncedPhone, locale])

  const clearCustomer = () => {
    setPhone('')
    setCustName('')
    setCustCity('')
    setCustAddress('')
    setCustMatch(null)
    setCustLookupError(false)
  }

  const shownResults = debounced.length < 2 ? [] : results
  const totalMinor = basket.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0)

  const addLine = (
    product: StoreSaleProductHit,
    variant: StoreSaleVariantHit,
    optionLabel: string,
    qty: number,
  ) => {
    setFlash(null)
    if (basket.some((line) => line.variantId === variant.variantId)) {
      setFlash(t('storeSales.alreadyInBasket'))
      return
    }
    if (qty > variant.availableToSell) {
      setFlash(t('storeSales.notEnoughStock'))
      return
    }
    setBasket((current) => [
      ...current,
      {
        variantId: variant.variantId,
        productId: product.productId,
        productNameAr: product.nameAr,
        sku: variant.sku,
        optionLabel,
        unitPriceMinor: variant.priceMinor,
        quantity: qty,
        maxQty: variant.availableToSell,
      },
    ])
    setSelected(null)
    setQuery('')
  }

  const setLineQty = (variantId: string, qty: number) =>
    setBasket((current) =>
      current.map((line) =>
        line.variantId === variantId
          ? { ...line, quantity: Math.max(1, Math.min(qty, line.maxQty)) }
          : line,
      ),
    )

  const removeLine = (variantId: string) =>
    setBasket((current) => current.filter((line) => line.variantId !== variantId))

  const confirm = async () => {
    if (basket.length === 0 || saving) return
    setSaving(true)
    setFlash(null)
    try {
      const result = await client.createStoreSale({
        lines: basket.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
        note: note.trim() || undefined,
        customerPhone: withCustomer ? phone.trim() || undefined : undefined,
        customerName: withCustomer ? custName.trim() || undefined : undefined,
        customerCity: withCustomer ? custCity.trim() || undefined : undefined,
        customerAddress: withCustomer ? custAddress.trim() || undefined : undefined,
      })
      setDone(result)
      setBasket([])
      setNote('')
      setWithCustomer(false)
      clearCustomer()
    } catch {
      setFlash(t('storeSales.saleFailed'))
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setDone(null)
    setSelected(null)
    setQuery('')
    setResults([])
  }

  if (!canSell) {
    return (
      <Panel>
        <AdminEmpty
          icon={<Receipt size={22} aria-hidden="true" />}
          title={t('error.forbidden')}
          text={t('storeSales.requiresCatalog')}
        />
      </Panel>
    )
  }

  if (done) {
    return (
      <>
        <Panel>
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-success-soft text-success">
              <Receipt size={26} aria-hidden="true" />
            </span>
            <div>
              <p className="text-lg font-bold text-ink">{t('storeSales.successTitle')}</p>
              <p className="mt-1 text-sm text-ink-3">{t('storeSales.successStock')}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface-raised px-5 py-3">
              <p className="text-xs font-medium text-ink-3">{t('storeSales.successNumber')}</p>
              <p className="font-mono text-lg font-bold tracking-wide text-ink">{done.number}</p>
            </div>
            <p className="text-sm font-semibold text-ink">
              {t('storeSales.total')}: {formatPrice(done.totalMinor, locale)}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={reset}>
                <Plus size={16} aria-hidden="true" />
                {t('storeSales.newSale')}
              </Button>
              <Button variant="secondary" onClick={() => setDetailFor(done.id)}>
                {t('storeSales.viewDetails')}
              </Button>
            </div>
          </div>
        </Panel>
        {detailFor ? <SaleDetailDialog id={detailFor} onClose={() => setDetailFor(null)} /> : null}
      </>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
      {/* Search + selection */}
      <section className="lh-admin-section">
        <SectionHead title={t('storeSales.registerTitle')} sub={t('storeSales.registerHint')} />

        <div className="lh-admin-toolbar">
          <div className="lh-admin-toolbar-search">
            <Search size={15} aria-hidden="true" />
            <Input
              autoFocus
              aria-label={t('storeSales.searchPlaceholder')}
              placeholder={t('storeSales.searchPlaceholder')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelected(null)
              }}
            />
          </div>
        </div>

        {flash ? <Flash tone="error">{flash}</Flash> : null}

        <Panel flush>
          {debounced.length < 2 ? (
            <AdminEmpty
              icon={<ScanBarcode size={22} aria-hidden="true" />}
              title={t('storeSales.pickProduct')}
              text={t('storeSales.searchMin')}
            />
          ) : searching && shownResults.length === 0 ? (
            <RowSkeleton rows={4} />
          ) : searchError ? (
            <div className="p-5">
              <ErrorState error={new Error('search')} onRetry={() => setQuery((q) => `${q} `)} />
            </div>
          ) : shownResults.length === 0 ? (
            <AdminEmpty
              icon={<Search size={22} aria-hidden="true" />}
              title={t('storeSales.noResults')}
            />
          ) : (
            <ul className="lh-admin-list">
              {shownResults.map((product) => (
                <li key={product.productId}>
                  <button
                    type="button"
                    className="lh-admin-list-row"
                    onClick={() => setSelected(product)}
                  >
                    <span className="lh-admin-thumb" aria-hidden="true">
                      {product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.imageUrl} alt="" />
                      ) : (
                        monogram(product.nameAr)
                      )}
                    </span>
                    <div className="lh-admin-list-body">
                      <span className="lh-admin-list-title">{product.nameAr}</span>
                      <span className="lh-admin-list-meta">
                        {product.nameEn} · {formatPrice(product.fromPriceMinor, locale)}
                      </span>
                    </div>
                    <div className="lh-admin-list-trail">
                      {product.totalAvailableToSell > 0 ? (
                        <span className="lh-stock-pill lh-stock-pill--in">
                          {formatCount(product.totalAvailableToSell, locale)}
                        </span>
                      ) : (
                        <span className="lh-stock-pill lh-stock-pill--out">
                          {t('storeSales.outOfStock')}
                        </span>
                      )}
                      <ChevronLeft
                        size={15}
                        className="text-ink-4 rtl:rotate-180"
                        aria-hidden="true"
                      />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {selected ? (
          <ProductPicker
            product={selected}
            inBasket={basket.map((l) => l.variantId)}
            onCancel={() => setSelected(null)}
            onAdd={addLine}
          />
        ) : null}
      </section>

      {/* Basket */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Panel flush>
          <div className="lh-admin-panel-head">
            <div className="lh-admin-section-title flex items-center gap-2">
              <ShoppingCart size={16} aria-hidden="true" />
              {t('storeSales.basket')}
            </div>
            {basket.length > 0 ? (
              <span className="text-xs text-ink-3">
                {t('storeSales.itemsCount', { n: formatCount(basket.length, locale) })}
              </span>
            ) : null}
          </div>

          {basket.length === 0 ? (
            <AdminEmpty
              icon={<ShoppingCart size={20} aria-hidden="true" />}
              title={t('storeSales.basketEmpty')}
              text={t('storeSales.basketEmptyHint')}
            />
          ) : (
            <ul className="lh-admin-list">
              {basket.map((line) => (
                <li
                  key={line.variantId}
                  className="lh-admin-list-row"
                  style={{ alignItems: 'flex-start' }}
                >
                  <div className="lh-admin-list-body">
                    <span className="lh-admin-list-title">{line.productNameAr}</span>
                    <span className="lh-admin-list-meta">
                      {line.optionLabel ? `${line.optionLabel} · ` : ''}
                      {formatPrice(line.unitPriceMinor, locale)}
                    </span>
                    <div className="mt-1.5 flex items-center gap-1">
                      <button
                        type="button"
                        className="lh-icon-button lh-icon-button--sm lh-icon-button--plain"
                        aria-label={t('inventory.subQ')}
                        onClick={() => setLineQty(line.variantId, line.quantity - 1)}
                      >
                        <Minus size={13} aria-hidden="true" />
                      </button>
                      <span className="w-7 text-center text-sm font-bold tabular-nums">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        className="lh-icon-button lh-icon-button--sm lh-icon-button--plain"
                        aria-label={t('inventory.addQ')}
                        disabled={line.quantity >= line.maxQty}
                        onClick={() => setLineQty(line.variantId, line.quantity + 1)}
                      >
                        <Plus size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-sm font-bold tabular-nums text-ink">
                      {formatPrice(line.unitPriceMinor * line.quantity, locale)}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-ink-3 hover:text-danger"
                      onClick={() => removeLine(line.variantId)}
                    >
                      <Trash2 size={13} aria-hidden="true" className="inline" />{' '}
                      {t('storeSales.remove')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Customer capture — phone-first. Collapsed by default = the
              explicit "بيع بدون بيانات عميل" walk-in path. */}
          <div className="border-t border-border p-4">
            {!withCustomer ? (
              <button
                type="button"
                className="mb-3 w-full rounded-md border border-dashed border-border py-2 text-xs font-medium text-ink-3 hover:border-brand hover:text-ink"
                onClick={() => setWithCustomer(true)}
              >
                {t('storeSales.withCustomer')}
              </button>
            ) : (
              <div className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-surface-muted/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-2">
                    {t('storeSales.customerSection')}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-ink-3 hover:text-ink"
                    onClick={() => {
                      setWithCustomer(false)
                      clearCustomer()
                    }}
                  >
                    {t('storeSales.skipCustomer')}
                  </button>
                </div>
                <p className="text-[11px] leading-tight text-ink-4">
                  {t('storeSales.customerLookupHint')}
                </p>
                <Input
                  dir="ltr"
                  inputMode="tel"
                  aria-label={t('storeSales.customerPhoneLabel')}
                  placeholder={t('storeSales.customerPhoneLabel')}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                {custLookupError ? (
                  <p className="text-[11px] text-danger">{t('storeSales.customerLookupError')}</p>
                ) : custMatch ? (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-success-soft/40 px-2 py-1.5 text-[11px] text-ink-2">
                    <CustomerReturningBadge isReturning={custMatch.isReturning} />
                    <span className="font-semibold text-ink">
                      {(locale === 'ar' ? custMatch.nameAr : custMatch.nameEn) ??
                        custMatch.nameAr ??
                        custMatch.nameEn ??
                        t('storeSales.customerMatched')}
                    </span>
                    {((locale === 'ar' ? custMatch.cityAr : custMatch.cityEn) ??
                    custMatch.cityAr) ? (
                      <span className="text-ink-4">
                        ·{' '}
                        {(locale === 'ar' ? custMatch.cityAr : custMatch.cityEn) ??
                          custMatch.cityAr}
                      </span>
                    ) : null}
                  </div>
                ) : phone.trim().length >= 6 ? (
                  <p className="text-[11px] text-ink-4">{t('storeSales.customerNew')}</p>
                ) : null}
                <Input
                  aria-label={t('storeSales.customerNameLabel')}
                  placeholder={t('storeSales.customerNameLabel')}
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                />
                <div className="flex gap-2">
                  <Input
                    aria-label={t('storeSales.customerCityLabel')}
                    placeholder={t('storeSales.customerCityLabel')}
                    value={custCity}
                    onChange={(e) => setCustCity(e.target.value)}
                  />
                  <Input
                    aria-label={t('storeSales.customerAddressLabel')}
                    placeholder={t('storeSales.customerAddressLabel')}
                    value={custAddress}
                    onChange={(e) => setCustAddress(e.target.value)}
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              className="mb-3 text-xs font-medium text-ink-3 hover:text-ink"
              onClick={() => setExtra((v) => !v)}
              aria-expanded={extra}
            >
              {extra ? t('common.hide') : t('common.show')} · {t('storeSales.noteLabel')}
            </button>
            {extra ? (
              <div className="mb-3 flex flex-col gap-2">
                <Input
                  placeholder={t('storeSales.notePlaceholder')}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            ) : null}

            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink-2">{t('storeSales.total')}</span>
              <span className="font-mono text-lg font-extrabold tabular-nums text-ink">
                {formatPrice(totalMinor, locale)}
              </span>
            </div>
            <Button
              className="mt-3 w-full"
              size="lg"
              disabled={basket.length === 0}
              loading={saving}
              onClick={confirm}
            >
              {saving ? t('storeSales.saving') : t('storeSales.confirmSale')}
            </Button>
          </div>
        </Panel>
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Product picker (options + quantity)
// ---------------------------------------------------------------------------

function ProductPicker({
  product,
  inBasket,
  onCancel,
  onAdd,
}: {
  product: StoreSaleProductHit
  inBasket: string[]
  onCancel: () => void
  onAdd: (
    product: StoreSaleProductHit,
    variant: StoreSaleVariantHit,
    optionLabel: string,
    qty: number,
  ) => void
}) {
  const t = useT()
  const locale = useLocale()
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [qty, setQty] = useState(1)

  const variant = useMemo<StoreSaleVariantHit | undefined>(() => {
    if (!product.hasOptions) return product.variants[0]
    const chosen = product.options.map((o) => choice[o.id]).filter(Boolean) as string[]
    if (chosen.length !== product.options.length) return undefined
    return product.variants.find(
      (v) =>
        v.optionValueIds.length === chosen.length &&
        chosen.every((id) => v.optionValueIds.includes(id)),
    )
  }, [product, choice])

  const optionLabel = useMemo(() => {
    if (!product.hasOptions) return ''
    return product.options
      .map((o) => {
        const value = o.values.find((val) => val.id === choice[o.id])
        return value ? (locale === 'ar' ? value.valueAr : value.valueEn) : ''
      })
      .filter(Boolean)
      .join(' / ')
  }, [product, choice, locale])

  const available = variant?.availableToSell ?? 0
  const already = variant ? inBasket.includes(variant.variantId) : false
  const canAdd = variant !== undefined && available > 0 && qty <= available && !already

  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink">{product.nameAr}</p>
          <p className="text-xs text-ink-3">{product.nameEn}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>

      {product.hasOptions ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {product.options.map((option) => (
            <Field key={option.id} label={locale === 'ar' ? option.nameAr : option.nameEn}>
              <Select
                value={choice[option.id] ?? ''}
                onChange={(e) => setChoice((c) => ({ ...c, [option.id]: e.target.value }))}
              >
                <option value="">{t('storeSales.chooseOptions')}</option>
                {option.values.map((value) => (
                  <option key={value.id} value={value.id}>
                    {locale === 'ar' ? value.valueAr : value.valueEn}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-xs font-medium text-ink-3">{t('storeSales.quantity')}</span>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              className="lh-icon-button lh-icon-button--plain"
              aria-label={t('inventory.subQ')}
              disabled={qty <= 1}
              onClick={() => setQty((n) => Math.max(1, n - 1))}
            >
              <Minus size={15} aria-hidden="true" />
            </button>
            <span className="w-10 text-center text-lg font-extrabold tabular-nums">{qty}</span>
            <button
              type="button"
              className="lh-icon-button lh-icon-button--plain"
              aria-label={t('inventory.addQ')}
              disabled={variant !== undefined && qty >= available}
              onClick={() => setQty((n) => n + 1)}
            >
              <Plus size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="text-end">
          {variant ? (
            <p className={`text-xs font-semibold ${available > 0 ? 'text-ink-3' : 'text-danger'}`}>
              {available > 0
                ? t('storeSales.availablePieces', { n: formatCount(available, locale) })
                : t('storeSales.outOfStock')}
            </p>
          ) : (
            <p className="text-xs text-ink-4">{t('storeSales.chooseOptions')}</p>
          )}
          {variant ? (
            <p className="text-base font-bold tabular-nums text-ink">
              {formatPrice(variant.priceMinor * qty, locale)}
            </p>
          ) : null}
        </div>
      </div>

      {already ? (
        <p className="mt-2 text-xs font-medium text-warning">{t('storeSales.alreadyInBasket')}</p>
      ) : null}

      <Button
        className="mt-4 w-full sm:w-auto"
        disabled={!canAdd}
        onClick={() => variant && onAdd(product, variant, optionLabel, qty)}
      >
        <Plus size={16} aria-hidden="true" />
        {t('storeSales.addToBasket')}
      </Button>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function HistoryView() {
  const t = useT()
  const locale = useLocale()
  const searchParams = useSearchParams()
  const [page, setPage] = useState(1)
  const [search, setSearchRaw] = useState('')
  const debounced = useDebounced(search.trim())
  // Deep link from Customer 360's timeline: /admin/store-sales?sale=<id>
  const [detailFor, setDetailFor] = useState<string | null>(searchParams.get('sale'))

  const onSearch = (value: string) => {
    setSearchRaw(value)
    setPage(1)
  }

  const { data, error, loading, reload } = useResource(
    () =>
      client.listStoreSales({ page, pageSize: DEFAULT_PAGE_SIZE, search: debounced || undefined }),
    [page, debounced],
    { revalidate: true },
  )

  const rows = data?.data ?? []

  return (
    <section className="lh-admin-section">
      <Toolbar>
        <SearchField
          value={search}
          onChange={onSearch}
          placeholder={t('storeSales.historySearchPlaceholder')}
        />
        {data ? (
          <span className="lh-admin-toolbar-count">
            {t('common.resultsOf', { count: data.meta.total })}
          </span>
        ) : null}
      </Toolbar>

      {loading && !data ? (
        <Panel flush>
          <RowSkeleton rows={6} />
        </Panel>
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <Panel>
          <AdminEmpty
            icon={<Receipt size={22} aria-hidden="true" />}
            title={t('storeSales.historyEmpty')}
          />
        </Panel>
      ) : (
        <>
          {/* Mobile cards */}
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((sale) => (
              <li key={sale.id}>
                <button
                  type="button"
                  className="lh-admin-record w-full text-start"
                  onClick={() => setDetailFor(sale.id)}
                >
                  <span className="lh-admin-record-body">
                    <span className="lh-admin-record-title font-mono">{sale.number}</span>
                    <span className="lh-admin-record-meta">
                      <span>{sale.staffNameAr}</span>
                      <span>·</span>
                      <span>
                        {t('storeSales.itemsCount', { n: formatCount(sale.itemCount, locale) })}
                      </span>
                      <span>·</span>
                      <span>{formatRelative(sale.createdAt, locale)}</span>
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-ink">
                    {formatPrice(sale.totalMinor, locale)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <Panel flush className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="lh-admin-table">
                <thead>
                  <tr>
                    <th>{t('storeSales.numberColumn')}</th>
                    <th>{t('storeSales.timeColumn')}</th>
                    <th>{t('storeSales.staffColumn')}</th>
                    <th className="lh-admin-td-num">{t('storeSales.itemsColumn')}</th>
                    <th className="lh-admin-td-num">{t('storeSales.totalColumn')}</th>
                    <th aria-label={t('common.actions')} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((sale) => (
                    <tr key={sale.id}>
                      <td className="font-mono font-medium">{sale.number}</td>
                      <td className="text-ink-3">{formatRelative(sale.createdAt, locale)}</td>
                      <td className="text-ink-2">
                        {locale === 'ar'
                          ? sale.staffNameAr
                          : (sale.staffNameEn ?? sale.staffNameAr)}
                      </td>
                      <td className="lh-admin-td-num text-ink-2">
                        {formatCount(sale.itemCount, locale)}
                      </td>
                      <td className="lh-admin-td-num font-bold text-ink">
                        {formatPrice(sale.totalMinor, locale)}
                      </td>
                      <td className="text-end">
                        <button
                          type="button"
                          className="lh-admin-link"
                          onClick={() => setDetailFor(sale.id)}
                        >
                          {t('storeSales.viewDetails')}
                          <ChevronLeft size={14} className="rtl:rotate-180" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {data ? <Pagination meta={data.meta} onPage={setPage} /> : null}
        </>
      )}

      {detailFor ? <SaleDetailDialog id={detailFor} onClose={() => setDetailFor(null)} /> : null}
    </section>
  )
}

function SaleDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT()
  const locale = useLocale()
  const { data, error, loading, reload } = useResource(() => client.getStoreSale(id), [id])

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('storeSales.detailsTitle')}
      closeLabel={t('common.close')}
    >
      {loading ? (
        <p className="text-sm text-ink-3">{t('common.loading')}</p>
      ) : error || !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-base font-bold text-ink">{data.number}</p>
              <p className="text-xs text-ink-3">
                {formatRelative(data.createdAt, locale)} ·{' '}
                {locale === 'ar' ? data.staffNameAr : (data.staffNameEn ?? data.staffNameAr)}
              </p>
            </div>
            <p className="font-mono text-lg font-extrabold tabular-nums text-ink">
              {formatPrice(data.totalMinor, locale)}
            </p>
          </div>

          {data.customer ? (
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-3">{t('customerCard.title')}</p>
              <CustomerCardView
                customer={data.customer}
                href={`/admin/customers/${data.customer.id}`}
              />
            </div>
          ) : data.customerPhoneNormalized ? (
            <p dir="ltr" className="text-start text-xs text-ink-3">
              {formatPhone(data.customerPhoneNormalized, { intl: true })}
            </p>
          ) : null}

          <ul className="flex flex-col rounded-lg border border-border">
            {data.items.map((item) => (
              <li
                key={item.variantId}
                className="flex items-center justify-between gap-3 border-b border-border p-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {locale === 'ar' ? item.productNameAr : item.productNameEn}
                  </p>
                  <p className="truncate text-xs text-ink-3">
                    {(locale === 'ar' ? item.variantLabelAr : item.variantLabelEn) ?? item.sku}
                    {' · '}
                    {formatCount(item.quantity, locale)} ×{' '}
                    {formatPrice(item.unitPriceMinor, locale)}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
                  {formatPrice(item.lineTotalMinor, locale)}
                </span>
              </li>
            ))}
          </ul>

          {data.note ? (
            <p className="rounded-md bg-surface-muted p-3 text-sm text-ink-2" dir="auto">
              {data.note}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
