'use client'

import { TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Dialog, Input, Select } from '@likehoney/ui'

import {
  client,
  type CoveredMargin,
  type ReportPeriod,
  type ReportsBreakdown,
  type ReportsCustomers,
  type ReportsOverview,
  type ReportsProducts,
  type ReportsRangeQuery,
  type ReportsRegions,
  type ReportsSales,
  type ReportsStagnantQuery,
} from '../../../lib/admin/client'
import { useResource } from '../../../lib/admin/hooks'
import { useAuth } from '../../../lib/admin/auth'
import { useLocale, useT, type DictKey } from '../../../lib/admin/i18n'
import {
  formatCount,
  formatPhone,
  formatPrice,
  formatStoreDateTime,
} from '../../../lib/admin/format'
import {
  AdminEmpty,
  AdminPage,
  ErrorState,
  PageHeader,
  Panel,
  RowSkeleton,
} from '../_components/shared'

type TabKey = 'overview' | 'sales' | 'products' | 'suppliers' | 'customers' | 'regions'

const TABS: { key: TabKey; label: DictKey }[] = [
  { key: 'overview', label: 'reports.tab.overview' },
  { key: 'sales', label: 'reports.tab.sales' },
  { key: 'products', label: 'reports.tab.products' },
  { key: 'suppliers', label: 'reports.tab.suppliers' },
  { key: 'customers', label: 'reports.tab.customers' },
  { key: 'regions', label: 'reports.tab.regions' },
]

const MODES: { key: ReportPeriod; label: DictKey }[] = [
  { key: 'day', label: 'reports.mode.day' },
  { key: 'week', label: 'reports.mode.week' },
  { key: 'month', label: 'reports.mode.month' },
  { key: 'custom', label: 'reports.mode.custom' },
]

/** Report period state, serialized into the URL so refresh / share / back all
 *  keep the same window (§17). */
interface PeriodState {
  period: ReportPeriod
  date?: string
  month?: string
  fromDate?: string
  toDate?: string
}

function readPeriod(sp: URLSearchParams): PeriodState {
  const period = (sp.get('period') as ReportPeriod | null) ?? 'month'
  return {
    period: MODES.some((m) => m.key === period) ? period : 'month',
    date: sp.get('date') ?? undefined,
    month: sp.get('month') ?? undefined,
    fromDate: sp.get('fromDate') ?? undefined,
    toDate: sp.get('toDate') ?? undefined,
  }
}

function periodToQuery(p: PeriodState): ReportsRangeQuery {
  if (p.period === 'day' || p.period === 'week') return { period: p.period, date: p.date }
  if (p.period === 'month') return { period: 'month', month: p.month }
  return { period: 'custom', fromDate: p.fromDate, toDate: p.toDate }
}

export default function AdminReportsPage() {
  const t = useT()
  const { hasPermission } = useAuth()
  const canRead = hasPermission('reports:read')
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [tab, setTab] = useState<TabKey>('overview')

  const period = useMemo(() => readPeriod(new URLSearchParams(sp.toString())), [sp])

  const setPeriod = useCallback(
    (next: Partial<PeriodState> & { period: ReportPeriod }) => {
      const merged: PeriodState = { ...period, ...next }
      const params = new URLSearchParams()
      params.set('period', merged.period)
      if (merged.period === 'day' || merged.period === 'week') {
        if (merged.date) params.set('date', merged.date)
      } else if (merged.period === 'month') {
        if (merged.month) params.set('month', merged.month)
      } else {
        if (merged.fromDate) params.set('fromDate', merged.fromDate)
        if (merged.toDate) params.set('toDate', merged.toDate)
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [period, pathname, router],
  )

  const query = useMemo(() => periodToQuery(period), [period])

  if (!canRead) {
    return (
      <AdminPage width="report">
        <PageHeader title={t('reports.title')} description={t('reports.description')} />
        <Panel>
          <AdminEmpty
            icon={<TrendingUp size={22} aria-hidden="true" />}
            title={t('error.forbidden')}
            text={t('reports.forbidden')}
          />
        </Panel>
      </AdminPage>
    )
  }

  return (
    <AdminPage width="wide">
      <PageHeader title={t('reports.title')} description={t('reports.description')} />

      <PeriodControl period={period} onChange={setPeriod} />

      <div
        className="mb-4 flex gap-0.5 overflow-x-auto rounded-lg border border-border bg-surface p-0.5"
        role="tablist"
        aria-label={t('reports.title')}
      >
        {TABS.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={tab === x.key}
            className={`lh-admin-hub-tab shrink-0${tab === x.key ? ' lh-admin-hub-tab--active' : ''}`}
            onClick={() => setTab(x.key)}
          >
            {t(x.label)}
          </button>
        ))}
      </div>

      {tab === 'overview' ? <OverviewTab query={query} /> : null}
      {tab === 'sales' ? <SalesTab query={query} /> : null}
      {tab === 'products' ? <ProductsTab period={period} /> : null}
      {tab === 'suppliers' ? <BreakdownTab query={query} kind="suppliers" /> : null}
      {tab === 'customers' ? <CustomersTab query={query} /> : null}
      {tab === 'regions' ? <RegionsTab query={query} /> : null}
    </AdminPage>
  )
}

// ---------------------------------------------------------------------------
// Period control (§11–§18)
// ---------------------------------------------------------------------------

function PeriodControl({
  period,
  onChange,
}: {
  period: PeriodState
  onChange: (next: Partial<PeriodState> & { period: ReportPeriod }) => void
}) {
  const t = useT()
  const today = new Date().toISOString().slice(0, 10)
  const thisMonth = today.slice(0, 7)
  return (
    <div className="lh-report-toolbar">
      <div className="flex flex-col gap-1">
        <span className="lh-admin-field-label">{t('reports.periodLabel')}</span>
        <div
          className="flex gap-0.5 self-start rounded-lg border border-border bg-surface p-0.5"
          role="tablist"
          aria-label={t('reports.periodLabel')}
        >
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={period.period === m.key}
              className={`lh-admin-hub-tab${period.period === m.key ? ' lh-admin-hub-tab--active' : ''}`}
              onClick={() => onChange({ period: m.key })}
            >
              {t(m.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {period.period === 'day' || period.period === 'week' ? (
          <label className="flex items-center gap-1.5 text-xs text-ink-3">
            {period.period === 'week' ? t('reports.pickWeekDay') : t('reports.pickDay')}
            <Input
              type="date"
              value={period.date ?? today}
              max={today}
              onChange={(e) => onChange({ period: period.period, date: e.target.value })}
            />
          </label>
        ) : null}
        {period.period === 'month' ? (
          <label className="flex items-center gap-1.5 text-xs text-ink-3">
            {t('reports.pickMonth')}
            <Input
              type="month"
              value={period.month ?? thisMonth}
              max={thisMonth}
              onChange={(e) => onChange({ period: 'month', month: e.target.value })}
            />
          </label>
        ) : null}
        {period.period === 'custom' ? (
          <>
            <label className="flex items-center gap-1.5 text-xs text-ink-3">
              {t('reports.from')}
              <Input
                type="date"
                value={period.fromDate ?? today}
                max={today}
                onChange={(e) => onChange({ period: 'custom', fromDate: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-3">
              {t('reports.to')}
              <Input
                type="date"
                value={period.toDate ?? period.fromDate ?? today}
                max={today}
                onChange={(e) => onChange({ period: 'custom', toDate: e.target.value })}
              />
            </label>
          </>
        ) : null}
      </div>
    </div>
  )
}

/** The unambiguous "what this covers" caption (§18), from the server label. */
function PeriodCaption({ info }: { info: { humanLabelAr: string; humanLabelEn: string } }) {
  const locale = useLocale()
  return (
    <p className="mb-3 text-sm font-semibold text-ink-2">
      {locale === 'ar' ? info.humanLabelAr : info.humanLabelEn}
    </p>
  )
}

function Delta({ pct }: { pct: number | null }) {
  const t = useT()
  if (pct === null) return <span className="text-[11px] text-ink-4">{t('reports.noBaseline')}</span>
  const up = pct >= 0
  return (
    <span className={`text-[11px] font-semibold ${up ? 'text-success' : 'text-danger'}`} dir="ltr">
      {up ? '▲' : '▼'} {Math.abs(pct)}% <span className="text-ink-4">· {t('reports.vsPrev')}</span>
    </span>
  )
}

function Kpi({
  label,
  value,
  hint,
  delta,
  primary,
}: {
  label: string
  value: string
  hint?: string
  delta?: number | null
  /** Larger number + raised surface — for the 4 headline commercial KPIs. */
  primary?: boolean
}) {
  return (
    <div className={`lh-report-kpi${primary ? ' lh-report-kpi--primary' : ''}`}>
      <p className="lh-report-kpi-label">{label}</p>
      <p className="lh-report-kpi-value" dir="ltr">
        {value}
      </p>
      {delta !== undefined ? <Delta pct={delta} /> : null}
      {hint ? <p className="lh-report-kpi-note">{hint}</p> : null}
    </div>
  )
}

/**
 * Covered-margin card (§1–§4). Unknown cost is NEVER treated as 0:
 *  - full coverage → normal "هامش البضاعة"
 *  - partial       → "هامش المبيعات المغطاة بالتكلفة" + the % it covers
 *  - 0% coverage   → "غير متاح"
 * Coverage % is always shown as its own small line.
 */
function MarginKpi({ margin }: { margin: CoveredMargin }) {
  const t = useT()
  const locale = useLocale()
  const unavailable = margin.coveredGrossMarginMinor == null
  const label = margin.complete
    ? t('reports.kpi.grossMargin')
    : unavailable
      ? t('reports.kpi.grossMargin')
      : t('reports.kpi.coveredMargin')
  return (
    <div className="lh-report-kpi lh-report-kpi--primary">
      <p className="lh-report-kpi-label">{label}</p>
      <p className="lh-report-kpi-value" dir="ltr">
        {unavailable
          ? t('reports.kpi.marginUnavailable')
          : formatPrice(margin.coveredGrossMarginMinor as number, locale)}
      </p>
      <p className="lh-report-kpi-note">
        {t('reports.kpi.costCoverage')}:{' '}
        <span className="font-semibold">{margin.coveragePct}%</span>
      </p>
      <p className="lh-report-kpi-note">
        {unavailable
          ? t('reports.kpi.marginUnavailableNote')
          : margin.complete
            ? t('reports.kpi.grossMarginHint')
            : t('reports.kpi.coveredMarginNote', { pct: margin.coveragePct })}
      </p>
    </div>
  )
}

/** Covered margin for a table row: value or "غير متاح", with coverage % beneath. */
function MarginCell({ margin }: { margin: CoveredMargin }) {
  const t = useT()
  const locale = useLocale()
  if (margin.coveredGrossMarginMinor == null) {
    return <span className="text-ink-4">{t('reports.breakdown.na')}</span>
  }
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={margin.complete ? 'font-semibold text-ink' : 'text-ink-2'}>
        {formatPrice(margin.coveredGrossMarginMinor, locale)}
      </span>
      {!margin.complete ? (
        <span className="text-[10px] text-ink-4">
          {margin.coveragePct}% {t('reports.breakdown.covered')}
        </span>
      ) : null}
    </span>
  )
}

function TabFrame<T>({
  loader,
  deps,
  children,
}: {
  loader: () => Promise<T>
  deps: unknown[]
  children: (data: T) => React.ReactNode
}) {
  const { data, error, loading, reload } = useResource(loader, deps)
  if (loading && !data)
    return (
      <Panel flush>
        <RowSkeleton rows={6} />
      </Panel>
    )
  if (error || !data) return <ErrorState error={error} onRetry={reload} />
  return <>{children(data)}</>
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewTab({ query }: { query: ReportsRangeQuery }) {
  const t = useT()
  const locale = useLocale()
  return (
    <TabFrame<ReportsOverview>
      loader={() => client.reportsOverview(query)}
      deps={[JSON.stringify(query)]}
    >
      {(d) => (
        <div className="flex flex-col gap-6">
          <div>
            <PeriodCaption info={d.period} />
            {/* B — primary commercial KPIs (§7): the four numbers the owner reads first */}
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Kpi
                primary
                label={t('reports.kpi.merchandise')}
                value={formatPrice(d.merchandiseRevenue.currentMinor, locale)}
                delta={d.merchandiseRevenue.changePct}
                hint={t('reports.kpi.merchandiseHint')}
              />
              <Kpi
                primary
                label={t('reports.kpi.completedTx')}
                value={formatCount(d.completedTransactions.current, locale)}
                delta={d.completedTransactions.changePct}
              />
              <Kpi
                primary
                label={t('reports.kpi.unitsSold')}
                value={formatCount(d.unitsSold.current, locale)}
                delta={d.unitsSold.changePct}
              />
              <Kpi
                primary
                label={t('reports.kpi.avgBasket')}
                value={formatPrice(d.averageBasketMinor, locale)}
              />
            </div>
          </div>

          {/* C — channel + financial truth row (§7): secondary emphasis */}
          <section className="lh-admin-section">
            <h2 className="lh-report-section-title mb-2">
              {t('reports.section.channelFinancial')}
            </h2>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Kpi
                label={t('reports.kpi.channelOnline')}
                value={formatPrice(d.channelSplit.onlineMinor, locale)}
              />
              <Kpi
                label={t('reports.kpi.channelStore')}
                value={formatPrice(d.channelSplit.storeMinor, locale)}
              />
              <Kpi
                label={t('reports.kpi.deliveryFees')}
                value={formatPrice(d.deliveryFees.currentMinor, locale)}
                delta={d.deliveryFees.changePct}
                hint={t('reports.kpi.deliveryFeesHint')}
              />
              <MarginKpi margin={d.margin} />
            </div>
          </section>

          {/* Customers at a glance — tertiary */}
          <section className="lh-admin-section">
            <h2 className="lh-report-section-title mb-2">{t('reports.section.customersGlance')}</h2>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Kpi
                label={t('reports.kpi.purchasingCustomers')}
                value={formatCount(d.customers.purchasingCount, locale)}
              />
              <Kpi
                label={t('reports.kpi.newCustomers')}
                value={formatCount(d.customers.newCount, locale)}
              />
              <Kpi
                label={t('reports.kpi.repeatPurchasers')}
                value={formatCount(d.customers.repeatPurchaserCount, locale)}
              />
              <Kpi
                label={t('reports.kpi.repeatPurchaseRate')}
                value={`${d.customers.repeatPurchaserRatePct}%`}
              />
            </div>
          </section>

          <section className="lh-admin-section">
            <h2 className="lh-report-section-title mb-2">{t('reports.insights.title')}</h2>
            {d.insights.length === 0 ? (
              <Panel>
                <p className="text-sm text-ink-3">{t('reports.insights.empty')}</p>
              </Panel>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.insights.map((ins) => (
                  <li
                    key={ins.code}
                    className={`rounded-lg border p-3 text-sm ${
                      ins.kind === 'positive'
                        ? 'border-success/30 bg-success-soft/40 text-ink'
                        : ins.kind === 'attention'
                          ? 'border-warning/40 bg-warning-soft/40 text-ink'
                          : 'border-border bg-surface text-ink-2'
                    }`}
                    dir="auto"
                  >
                    {locale === 'ar' ? ins.textAr : ins.textEn}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="lh-admin-section">
            <h2 className="lh-report-section-title mb-1">{t('reports.pipeline.title')}</h2>
            <p className="mb-2 text-xs text-ink-4">{t('reports.pipeline.hint')}</p>
            <div className="grid grid-cols-2 gap-2">
              <Kpi
                label={t('reports.pipeline.processing')}
                value={`${formatCount(d.pipeline.processingOrders, locale)} · ${formatPrice(d.pipeline.processingValueMinor, locale)}`}
              />
              <Kpi
                label={t('reports.pipeline.delivering')}
                value={`${formatCount(d.pipeline.deliveringOrders, locale)} · ${formatPrice(d.pipeline.deliveringValueMinor, locale)}`}
              />
            </div>
          </section>
        </div>
      )}
    </TabFrame>
  )
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

function SalesTab({ query }: { query: ReportsRangeQuery }) {
  const t = useT()
  const locale = useLocale()
  return (
    <TabFrame<ReportsSales>
      loader={() => client.reportsSales(query)}
      deps={[JSON.stringify(query)]}
    >
      {(d) => {
        const max = Math.max(1, ...d.daily.map((x) => x.merchandiseRevenueMinor))
        return (
          <div className="flex flex-col gap-4">
            <PeriodCaption info={d.period} />
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              <Kpi
                label={t('reports.kpi.merchandise')}
                value={formatPrice(d.totalMerchandiseRevenueMinor, locale)}
                delta={d.changePct}
              />
              <Kpi
                label={t('reports.kpi.deliveryFees')}
                value={formatPrice(d.totalDeliveryFeesMinor, locale)}
              />
              <Kpi
                label={t('reports.sales.prevTotal')}
                value={formatPrice(d.previousMerchandiseRevenueMinor, locale)}
              />
            </div>
            <Panel flush>
              <div className="overflow-x-auto">
                <table className="lh-admin-table">
                  <thead>
                    <tr>
                      <th>{t('reports.sales.colDate')}</th>
                      <th className="lh-admin-td-num">{t('reports.sales.colOnline')}</th>
                      <th className="lh-admin-td-num">{t('reports.sales.colStore')}</th>
                      <th className="lh-admin-td-num">{t('reports.sales.colTotal')}</th>
                      <th className="lh-admin-td-num">{t('reports.sales.colOrders')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.daily.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-sm text-ink-3">
                          {t('reports.sales.empty')}
                        </td>
                      </tr>
                    ) : (
                      d.daily.map((row) => (
                        <tr key={row.date}>
                          <td className="whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="hidden h-1.5 rounded bg-brand/60 sm:block"
                                style={{
                                  width: `${Math.round((row.merchandiseRevenueMinor / max) * 72) + 4}px`,
                                }}
                              />
                              {row.date}
                            </div>
                          </td>
                          <td className="lh-admin-td-num text-ink-2">
                            {formatPrice(row.onlineRevenueMinor, locale)}
                          </td>
                          <td className="lh-admin-td-num text-ink-2">
                            {formatPrice(row.storeRevenueMinor, locale)}
                          </td>
                          <td className="lh-admin-td-num font-bold text-ink">
                            {formatPrice(row.merchandiseRevenueMinor, locale)}
                          </td>
                          <td className="lh-admin-td-num text-ink-3">
                            {formatCount(row.ordersCount + row.storeSalesCount, locale)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        )
      }}
    </TabFrame>
  )
}

// ---------------------------------------------------------------------------
// Products & inventory (with stagnation filters — §24/§25)
// ---------------------------------------------------------------------------

const STAGNANT_DAYS = [7, 14, 30, 60, 90, 180]

/** Stagnation filters live in the URL alongside the period params (§1), so
 *  refresh / back-forward / copy-link preserve them and they compose with the
 *  period. `sd`/`cat`/`sup`/`st`/`nv`/`pq` are scoped names that never clash
 *  with `period`/`date`/`month`/`fromDate`/`toDate`. */
function ProductsTab({ period }: { period: PeriodState }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const days = Number(sp.get('sd')) || 30
  const cat = sp.get('cat') ?? ''
  const sup = sp.get('sup') ?? ''
  const withStockOnly = sp.get('st') !== '0' // default true
  const neverSoldOnly = sp.get('nv') === '1'
  const searchUrl = sp.get('pq') ?? ''
  const [searchRaw, setSearchRaw] = useState(searchUrl)
  const [searchDebounced, setSearchDebounced] = useState(searchUrl)
  useEffect(() => {
    const id = window.setTimeout(() => setSearchDebounced(searchRaw.trim()), 250)
    return () => window.clearTimeout(id)
  }, [searchRaw])

  const setStagnant = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(sp.toString())
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === '') params.delete(k)
        else params.set(k, v)
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, sp],
  )

  useEffect(() => {
    if (searchDebounced !== searchUrl) setStagnant({ pq: searchDebounced || null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDebounced])

  const cats = useResource(() => client.listCategories({ status: 'active', pageSize: 200 }), [])
  const sups = useResource(() => client.listSuppliers({ status: 'active', pageSize: 200 }), [])

  const query: ReportsStagnantQuery = {
    ...periodToQuery(period),
    stagnantDays: days,
    categoryId: cat || undefined,
    supplierId: sup || undefined,
    withStockOnly,
    neverSoldOnly,
    search: searchUrl.trim() || undefined,
  }

  return (
    <TabFrame<ReportsProducts>
      loader={() => client.reportsProducts(query)}
      deps={[JSON.stringify(query)]}
    >
      {(d) => (
        <div className="flex flex-col gap-6">
          <PeriodCaption info={d.period} />

          <section className="lh-admin-section">
            <h2 className="lh-admin-section-title mb-2">{t('reports.products.topTitle')}</h2>
            <Panel flush>
              <div className="overflow-x-auto">
                <table className="lh-admin-table">
                  <thead>
                    <tr>
                      <th>{t('reports.products.colProduct')}</th>
                      <th className="lh-admin-td-num">{t('reports.products.colUnits')}</th>
                      <th className="lh-admin-td-num">{t('reports.products.colRevenue')}</th>
                      <th className="lh-admin-td-num">{t('reports.products.colAvailable')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.topSellers.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-sm text-ink-3">
                          {t('reports.products.empty')}
                        </td>
                      </tr>
                    ) : (
                      d.topSellers.map((r) => (
                        <tr key={r.variantId}>
                          <td>
                            <div className="font-medium text-ink">
                              {locale === 'ar' ? r.productNameAr : r.productNameEn}
                            </div>
                            <div className="font-mono text-xs text-ink-3">{r.sku}</div>
                          </td>
                          <td className="lh-admin-td-num font-bold text-ink">
                            {formatCount(r.unitsSold, locale)}
                          </td>
                          <td className="lh-admin-td-num text-ink-2">
                            {formatPrice(r.revenueMinor, locale)}
                          </td>
                          <td className="lh-admin-td-num">
                            <span
                              className={
                                r.outOfStock
                                  ? 'text-danger'
                                  : r.lowStock
                                    ? 'text-warning'
                                    : 'text-ink-2'
                              }
                            >
                              {formatCount(r.availableToSell, locale)}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>

          <section className="lh-admin-section">
            <h2 className="lh-admin-section-title mb-1">{t('reports.products.stagnantTitle')}</h2>
            <p className="mb-2 text-xs text-ink-4">{t('reports.products.stagnantHint')}</p>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Select
                aria-label={t('reports.products.daysFilter')}
                value={String(days)}
                onChange={(e) => setStagnant({ sd: e.target.value })}
              >
                {STAGNANT_DAYS.map((n) => (
                  <option key={n} value={n}>
                    {t('reports.products.daysOption', { n })}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('reports.products.categoryFilter')}
                value={cat}
                onChange={(e) => setStagnant({ cat: e.target.value || null })}
              >
                <option value="">{t('reports.products.allCategories')}</option>
                {(cats.data?.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {locale === 'ar' ? c.nameAr : c.nameEn}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('reports.products.supplierFilter')}
                value={sup}
                onChange={(e) => setStagnant({ sup: e.target.value || null })}
              >
                <option value="">{t('reports.products.allSuppliers')}</option>
                {(sups.data?.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {locale === 'ar' ? s.nameAr : (s.nameEn ?? s.nameAr)}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1.5 text-xs text-ink-3">
                <input
                  type="checkbox"
                  checked={withStockOnly}
                  onChange={(e) => setStagnant({ st: e.target.checked ? null : '0' })}
                />
                {t('reports.products.withStockOnly')}
              </label>
              <label className="flex items-center gap-1.5 text-xs text-ink-3">
                <input
                  type="checkbox"
                  checked={neverSoldOnly}
                  onChange={(e) => setStagnant({ nv: e.target.checked ? '1' : null })}
                />
                {t('reports.products.neverSoldOnly')}
              </label>
              <Input
                placeholder={t('reports.products.searchPlaceholder')}
                value={searchRaw}
                onChange={(e) => setSearchRaw(e.target.value)}
              />
            </div>

            <Panel flush>
              <div className="overflow-x-auto">
                <table className="lh-admin-table">
                  <thead>
                    <tr>
                      <th>{t('reports.products.colProduct')}</th>
                      <th className="lh-admin-td-num">{t('reports.products.colDaysIdle')}</th>
                      <th className="lh-admin-td-num">{t('reports.products.colAvailable')}</th>
                      <th className="lh-admin-td-num">{t('reports.products.colPeriodUnits')}</th>
                      <th>{t('reports.products.colLastSold')}</th>
                      <th className="lh-admin-td-num">{t('reports.products.colCapital')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.stagnant.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-sm text-ink-3">
                          {t('reports.products.empty')}
                        </td>
                      </tr>
                    ) : (
                      d.stagnant.map((r) => {
                        const supplier =
                          locale === 'ar'
                            ? r.supplierNameAr
                            : (r.supplierNameEn ?? r.supplierNameAr)
                        const category =
                          locale === 'ar'
                            ? r.categoryNameAr
                            : (r.categoryNameEn ?? r.categoryNameAr)
                        return (
                          <tr key={r.variantId}>
                            <td>
                              <div className="font-medium text-ink">
                                {locale === 'ar' ? r.productNameAr : r.productNameEn}
                              </div>
                              <div className="text-xs text-ink-3">
                                <span className="font-mono">{r.sku}</span>
                                {[category, supplier].filter(Boolean).map((s) => (
                                  <span key={s}> · {s}</span>
                                ))}
                              </div>
                            </td>
                            <td className="lh-admin-td-num">
                              <span className="text-base font-bold tabular-nums text-ink">
                                {r.daysSinceLastSale == null
                                  ? t('reports.products.neverSold')
                                  : formatCount(r.daysSinceLastSale, locale)}
                              </span>
                              {r.daysSinceLastSale != null ? (
                                <span className="block text-[11px] text-ink-4">
                                  {t('reports.products.daysUnit')}
                                </span>
                              ) : null}
                            </td>
                            <td className="lh-admin-td-num font-semibold text-ink">
                              {formatCount(r.availableToSell, locale)}
                            </td>
                            <td className="lh-admin-td-num text-ink-2">
                              {formatCount(r.unitsSoldInWindow, locale)}
                            </td>
                            <td className="text-ink-3">
                              {r.lastSoldAt
                                ? formatStoreDateTime(r.lastSoldAt, locale)
                                : t('reports.products.neverSold')}
                            </td>
                            <td className="lh-admin-td-num text-ink-2">
                              {r.estimatedCapitalMinor == null
                                ? '—'
                                : formatPrice(r.estimatedCapitalMinor, locale)}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-border p-2 text-[11px] text-ink-4">
                {t('reports.products.capitalHint')}
              </p>
            </Panel>
          </section>
        </div>
      )}
    </TabFrame>
  )
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

function BreakdownTab({ query, kind }: { query: ReportsRangeQuery; kind: 'suppliers' }) {
  const t = useT()
  const locale = useLocale()
  const [drilldown, setDrilldown] = useState<{ id: string; label: string } | null>(null)
  return (
    <TabFrame<ReportsBreakdown>
      loader={() => client.reportsSuppliers(query)}
      deps={[kind, JSON.stringify(query)]}
    >
      {(d) => (
        <div className="flex flex-col gap-3">
          <PeriodCaption info={d.period} />
          {d.unattributedRevenueMinor > 0 ? (
            <p className="rounded-md bg-warning-soft/40 p-2 text-xs text-ink-2" dir="auto">
              {t('reports.breakdown.unattributed', {
                amount: formatPrice(d.unattributedRevenueMinor, locale),
              })}
            </p>
          ) : null}
          <Panel flush>
            <div className="overflow-x-auto">
              <table className="lh-admin-table">
                <thead>
                  <tr>
                    <th>{t('reports.breakdown.colName')}</th>
                    <th className="lh-admin-td-num">{t('reports.breakdown.colUnits')}</th>
                    <th className="lh-admin-td-num">{t('reports.breakdown.colRevenue')}</th>
                    <th className="lh-admin-td-num">{t('reports.breakdown.colMargin')}</th>
                    <th className="lh-admin-td-num">{t('reports.breakdown.colCoverage')}</th>
                    <th className="lh-admin-td-num">{t('reports.breakdown.colInventory')}</th>
                    <th className="lh-admin-td-num">{t('reports.breakdown.colStagnant')}</th>
                    <th aria-label={t('common.actions')} />
                  </tr>
                </thead>
                <tbody>
                  {d.rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-sm text-ink-3">
                        {t('reports.breakdown.empty')}
                      </td>
                    </tr>
                  ) : (
                    d.rows.map((r) => (
                      <tr key={r.key}>
                        <td className="font-medium text-ink" dir="auto">
                          {locale === 'ar' ? r.labelAr : r.labelEn}
                        </td>
                        <td className="lh-admin-td-num text-ink-2">
                          {formatCount(r.unitsSold, locale)}
                        </td>
                        <td className="lh-admin-td-num font-bold text-ink">
                          {formatPrice(r.revenueMinor, locale)}
                        </td>
                        <td className="lh-admin-td-num text-ink-2">
                          <MarginCell margin={r.margin} />
                        </td>
                        <td className="lh-admin-td-num text-ink-3">{r.margin.coveragePct}%</td>
                        <td className="lh-admin-td-num text-ink-2">
                          {formatCount(r.currentInventoryUnits ?? 0, locale)}
                        </td>
                        <td className="lh-admin-td-num text-ink-2">
                          {formatCount(r.stagnantSkuCount ?? 0, locale)}
                        </td>
                        <td className="text-end">
                          <button
                            type="button"
                            className="lh-admin-link"
                            onClick={() =>
                              setDrilldown({
                                id: r.key,
                                label: locale === 'ar' ? r.labelAr : r.labelEn,
                              })
                            }
                          >
                            {t('reports.breakdown.drilldown')}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {drilldown ? (
            <SupplierDrilldownDialog
              supplierId={drilldown.id}
              label={drilldown.label}
              query={query}
              onClose={() => setDrilldown(null)}
            />
          ) : null}
        </div>
      )}
    </TabFrame>
  )
}

function SupplierDrilldownDialog({
  supplierId,
  label,
  query,
  onClose,
}: {
  supplierId: string
  label: string
  query: ReportsRangeQuery
  onClose: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const { data, error, loading, reload } = useResource(
    () => client.reportsSupplierDrilldown(supplierId, query),
    [supplierId, JSON.stringify(query)],
  )
  return (
    <Dialog open onClose={onClose} title={label} closeLabel={t('common.close')}>
      {loading ? (
        <p className="text-sm text-ink-3">{t('common.loading')}</p>
      ) : error || !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="flex flex-col gap-3">
          <PeriodCaption info={data.period} />
          <p className="text-xs text-ink-4" dir="auto">
            {t('reports.breakdown.drilldownSplitHint')}
          </p>
          <div className="overflow-x-auto">
            <table className="lh-admin-table">
              <thead>
                <tr>
                  <th />
                  <th className="lh-admin-td-num" colSpan={3}>
                    {t('reports.breakdown.groupHistorical')}
                  </th>
                  <th className="lh-admin-td-num" colSpan={2}>
                    {t('reports.breakdown.groupCurrent')}
                  </th>
                </tr>
                <tr>
                  <th>{t('reports.products.colProduct')}</th>
                  <th className="lh-admin-td-num">{t('reports.products.colUnits')}</th>
                  <th className="lh-admin-td-num">{t('reports.products.colRevenue')}</th>
                  <th className="lh-admin-td-num">{t('reports.breakdown.colMargin')}</th>
                  <th className="lh-admin-td-num">{t('reports.products.colAvailable')}</th>
                  <th className="lh-admin-td-num">{t('reports.products.colDaysIdle')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-sm text-ink-3">
                      {t('reports.breakdown.drilldownEmpty')}
                    </td>
                  </tr>
                ) : (
                  data.rows.map((r) => (
                    <tr key={r.variantId}>
                      <td>
                        <div className="font-medium text-ink">
                          {locale === 'ar' ? r.productNameAr : r.productNameEn}
                        </div>
                        <div className="font-mono text-xs text-ink-3">{r.sku}</div>
                      </td>
                      <td className="lh-admin-td-num font-bold text-ink">
                        {formatCount(r.unitsSold, locale)}
                      </td>
                      <td className="lh-admin-td-num text-ink-2">
                        {formatPrice(r.revenueMinor, locale)}
                      </td>
                      <td className="lh-admin-td-num text-ink-2">
                        <MarginCell margin={r.margin} />
                      </td>
                      <td className="lh-admin-td-num text-ink-2">
                        {r.currentlySupplied ? (
                          formatCount(r.availableToSell, locale)
                        ) : (
                          <span
                            className="text-ink-4"
                            title={t('reports.breakdown.noLongerSuppliedHint')}
                          >
                            {t('reports.breakdown.noLongerSupplied')}
                          </span>
                        )}
                      </td>
                      <td className="lh-admin-td-num text-ink-3">
                        {r.daysSinceLastSale == null
                          ? t('reports.products.neverSold')
                          : formatCount(r.daysSinceLastSale, locale)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

function RegionsTab({ query }: { query: ReportsRangeQuery }) {
  const t = useT()
  const locale = useLocale()
  return (
    <TabFrame<ReportsRegions>
      loader={() => client.reportsRegions(query)}
      deps={[JSON.stringify(query)]}
    >
      {(d) => (
        <div className="flex flex-col gap-3">
          <PeriodCaption info={d.period} />
          <Panel flush>
            <div className="overflow-x-auto">
              <table className="lh-admin-table">
                <thead>
                  <tr>
                    <th>{t('reports.regions.colRegion')}</th>
                    <th className="lh-admin-td-num">{t('reports.regions.colOrders')}</th>
                    <th className="lh-admin-td-num">{t('reports.regions.colCustomers')}</th>
                    <th className="lh-admin-td-num">{t('reports.regions.colRevenue')}</th>
                    <th className="lh-admin-td-num">{t('reports.regions.colBasket')}</th>
                    <th>{t('reports.regions.colLast')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-sm text-ink-3">
                        {t('reports.regions.empty')}
                      </td>
                    </tr>
                  ) : (
                    d.rows.map((r) => (
                      <tr key={r.key}>
                        <td className="font-medium text-ink" dir="auto">
                          {r.key === 'unknown'
                            ? t('reports.regions.unknown')
                            : (locale === 'ar' ? r.labelAr : r.labelEn) || r.key}
                        </td>
                        <td className="lh-admin-td-num text-ink-2">
                          {formatCount(r.ordersCount, locale)}
                        </td>
                        <td className="lh-admin-td-num text-ink-2">
                          {formatCount(r.uniqueCustomers, locale)}
                        </td>
                        <td className="lh-admin-td-num font-bold text-ink">
                          {formatPrice(r.revenueMinor, locale)}
                        </td>
                        <td className="lh-admin-td-num text-ink-2">
                          {formatPrice(r.averageBasketMinor, locale)}
                        </td>
                        <td className="text-ink-3">
                          {r.lastActivityAt ? formatStoreDateTime(r.lastActivityAt, locale) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </TabFrame>
  )
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

function CustomersTab({ query }: { query: ReportsRangeQuery }) {
  const t = useT()
  const locale = useLocale()
  return (
    <TabFrame<ReportsCustomers>
      loader={() => client.reportsCustomers(query)}
      deps={[JSON.stringify(query)]}
    >
      {(d) => (
        <div className="flex flex-col gap-4">
          <PeriodCaption info={d.period} />
          <p className="text-xs text-ink-4">{t('reports.customers.purchaserNote')}</p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <Kpi
              label={t('reports.kpi.purchasingCustomers')}
              value={formatCount(d.uniqueCount, locale)}
            />
            <Kpi label={t('reports.kpi.newCustomers')} value={formatCount(d.newCount, locale)} />
            <Kpi
              label={t('reports.kpi.repeatPurchasers')}
              value={formatCount(d.repeatPurchaserCount, locale)}
            />
            <Kpi
              label={t('reports.kpi.repeatPurchaseRate')}
              value={`${d.repeatPurchaserRatePct}%`}
            />
            <Kpi
              label={t('reports.customers.channelBoth')}
              value={formatCount(d.channelCounts.both, locale)}
            />
            <Kpi
              label={t('reports.customers.channelSplit')}
              value={`${formatCount(d.channelCounts.onlineOnly, locale)} / ${formatCount(d.channelCounts.storeOnly, locale)}`}
              hint={t('reports.customers.channelSplitHint')}
            />
          </div>

          {/* Separate analytical cohorts — NOT purchaser KPIs. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Kpi
              label={t('reports.customers.returnedFromPrev')}
              value={formatCount(d.returnedFromPreviousPeriodCount, locale)}
              hint={t('reports.customers.returnedFromPrevHint')}
            />
            <Kpi
              label={t('reports.customers.noPurchase')}
              value={formatCount(d.contactsWithoutPurchase, locale)}
              hint={t('reports.customers.noPurchaseHint')}
            />
          </div>

          {/* Data quality — customer-link coverage (§6). */}
          <div className="rounded-lg border border-border bg-surface p-3">
            <p className="text-xs font-semibold text-ink-2">
              {t('reports.customers.linkCoverageTitle')}
            </p>
            <p className="mt-1 text-sm text-ink">
              {t('reports.customers.linkCoverageValue', {
                linked: formatCount(d.linkCoverage.completedTransactionsLinkedToCustomer, locale),
                total: formatCount(d.linkCoverage.completedTransactionsTotal, locale),
                pct: d.linkCoverage.customerLinkCoveragePct,
              })}
            </p>
            <p className="mt-1 text-[11px] leading-tight text-ink-4">
              {t('reports.customers.linkCoverageNote')}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-ink-3 sm:grid-cols-4">
              <div>
                <dt className="text-ink-4">{t('reports.customers.covOnlineLinked')}</dt>
                <dd className="text-ink-2">
                  {formatCount(d.linkCoverage.onlineCompletedLinked, locale)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-4">{t('reports.customers.covOnlineUnlinked')}</dt>
                <dd className="text-ink-2">
                  {formatCount(d.linkCoverage.onlineCompletedUnlinked, locale)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-4">{t('reports.customers.covStoreLinked')}</dt>
                <dd className="text-ink-2">
                  {formatCount(d.linkCoverage.storeCompletedLinked, locale)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-4">{t('reports.customers.covStoreUnlinked')}</dt>
                <dd className="text-ink-2">
                  {formatCount(d.linkCoverage.storeCompletedUnlinked, locale)}
                </dd>
              </div>
            </dl>
          </div>
          <section className="lh-admin-section">
            <h2 className="lh-admin-section-title mb-2">{t('reports.customers.topTitle')}</h2>
            <Panel flush>
              <div className="overflow-x-auto">
                <table className="lh-admin-table">
                  <thead>
                    <tr>
                      <th>{t('reports.customers.colCustomer')}</th>
                      <th className="lh-admin-td-num">{t('reports.customers.colOrders')}</th>
                      <th className="lh-admin-td-num">{t('reports.customers.colStore')}</th>
                      <th className="lh-admin-td-num">{t('reports.customers.colSpend')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.topCustomers.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-sm text-ink-3">
                          {t('reports.customers.empty')}
                        </td>
                      </tr>
                    ) : (
                      d.topCustomers.map((r) => (
                        <tr key={r.customerId}>
                          <td>
                            <Link
                              href={`/admin/customers/${r.customerId}`}
                              className="lh-admin-link font-medium"
                            >
                              {(locale === 'ar' ? r.nameAr : r.nameEn) ??
                                r.nameAr ??
                                r.nameEn ??
                                formatPhone(r.phoneNormalized)}
                            </Link>
                            <div dir="ltr" className="text-xs text-ink-3">
                              {formatPhone(r.phoneNormalized)}
                            </div>
                          </td>
                          <td className="lh-admin-td-num text-ink-2">
                            {formatCount(r.ordersCount, locale)}
                          </td>
                          <td className="lh-admin-td-num text-ink-2">
                            {formatCount(r.storeSalesCount, locale)}
                          </td>
                          <td className="lh-admin-td-num font-bold text-ink">
                            {formatPrice(r.spendMinor, locale)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>
        </div>
      )}
    </TabFrame>
  )
}
