'use client'

import { ClipboardList, SlidersHorizontal, X } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button, Field, Input, Select } from '@likehoney/ui'

import { ApiError, client, type AdminOrderListItem } from '../../../lib/admin/client'
import { useResource } from '../../../lib/admin/hooks'
import { subscribeOrders } from '../../../lib/admin/revalidate'
import { useAuth } from '../../../lib/admin/auth'
import { useLocale, useT, type DictKey } from '../../../lib/admin/i18n'
import {
  formatCount,
  formatPhone,
  formatPrice,
  formatStoreDateTime,
  formatStoreTime,
  storeDateOnlyToUtcRange,
} from '../../../lib/admin/format'
import {
  AdminEmpty,
  AdminPage,
  ErrorState,
  Flash,
  PageHeader,
  Panel,
  SearchField,
  errorMessage,
} from '../_components/shared'
import {
  canAdvanceFulfillment,
  NextActionButton,
  OrderCardsSkeleton,
  OrderRowsSkeleton,
  OrderStatusChip,
  PaymentCell,
  paymentPresentation,
  useDebounced,
} from './_components/order-ui'
import { CancelOrderDialog } from './_components/cancel-dialog'
import { Sheet } from './_components/sheet'

// ---------------------------------------------------------------------------
// Queue definitions
// ---------------------------------------------------------------------------

const QUEUES = ['processing', 'delivering', 'completed', 'cancelled', 'all'] as const
type Queue = (typeof QUEUES)[number]

const QUEUE_LABEL_KEY: Record<Queue, DictKey> = {
  processing: 'orders.queue.processing',
  delivering: 'orders.queue.delivering',
  completed: 'orders.queue.completed',
  cancelled: 'orders.queue.cancelled',
  all: 'orders.queue.all',
}

const EMPTY_KEY: Record<Queue, DictKey> = {
  processing: 'orders.empty.processing',
  delivering: 'orders.empty.delivering',
  completed: 'orders.empty.completed',
  cancelled: 'orders.empty.cancelled',
  all: 'orders.empty.all',
}

interface UrlState {
  status: Queue
  q: string
  method: string
  pstatus: string
  from: string
  to: string
}

function readUrlState(): UrlState {
  if (typeof window === 'undefined') {
    return { status: 'processing', q: '', method: '', pstatus: '', from: '', to: '' }
  }
  const p = new URLSearchParams(window.location.search)
  const status = p.get('status')
  return {
    status: (QUEUES as readonly string[]).includes(status ?? '') ? (status as Queue) : 'processing',
    q: p.get('q') ?? '',
    method: p.get('method') ?? '',
    pstatus: p.get('pstatus') ?? '',
    from: p.get('from') ?? '',
    to: p.get('to') ?? '',
  }
}

function writeUrlState(s: UrlState): void {
  if (typeof window === 'undefined') return
  const p = new URLSearchParams()
  if (s.status !== 'processing') p.set('status', s.status)
  if (s.q) p.set('q', s.q)
  if (s.method) p.set('method', s.method)
  if (s.pstatus) p.set('pstatus', s.pstatus)
  if (s.from) p.set('from', s.from)
  if (s.to) p.set('to', s.to)
  const qs = p.toString()
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  window.history.replaceState(null, '', next)
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminOrdersPage() {
  const t = useT()
  const locale = useLocale()
  const { hasPermission } = useAuth()
  const canRead = hasPermission('orders:read')
  const canWrite = hasPermission('orders:write')
  const canCancel = hasPermission('orders:cancel')

  const [status, setStatusRaw] = useState<Queue>(() => readUrlState().status)
  const [q, setQRaw] = useState(() => readUrlState().q)
  const [method, setMethodRaw] = useState(() => readUrlState().method)
  const [pstatus, setPstatusRaw] = useState(() => readUrlState().pstatus)
  const [from, setFromRaw] = useState(() => readUrlState().from)
  const [to, setToRaw] = useState(() => readUrlState().to)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const debouncedQ = useDebounced(q.trim(), 350)

  // Keyset pagination — accumulate pages, dedup by id. `cursor === undefined`
  // means "first page"; every query-shaping change resets it (in the setters
  // below, never in an effect).
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [refreshTick, setRefreshTick] = useState(0)
  const [rows, setRows] = useState<AdminOrderListItem[]>([])
  const cursorAtFetch = useRef<string | undefined>(undefined)

  const [flash, setFlash] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [cancelFor, setCancelFor] = useState<AdminOrderListItem | null>(null)

  const setStatus = (next: Queue) => {
    setStatusRaw(next)
    setCursor(undefined)
  }
  const setQ = (next: string) => {
    setQRaw(next)
    setCursor(undefined)
  }
  const setMethod = (next: string) => {
    setMethodRaw(next)
    setCursor(undefined)
  }
  const setPstatus = (next: string) => {
    setPstatusRaw(next)
    setCursor(undefined)
  }
  const setFrom = (next: string) => {
    setFromRaw(next)
    setCursor(undefined)
  }
  const setTo = (next: string) => {
    setToRaw(next)
    setCursor(undefined)
  }

  // Any change to a query-shaping value forces a first-page refetch even if the
  // cursor was already `undefined`.
  const restartList = useCallback(() => {
    setCursor(undefined)
    setRefreshTick((n) => n + 1)
  }, [])

  // Persist filter/queue state to the URL (back nav, refresh, shareable).
  useEffect(() => {
    writeUrlState({ status, q: debouncedQ, method, pstatus, from, to })
  }, [status, debouncedQ, method, pstatus, from, to])

  // Live coherence: an order transition anywhere refreshes the list so a row
  // leaves one queue and appears in another without a manual refresh.
  useEffect(() => subscribeOrders(() => restartList()), [restartList])

  const dateFromUtc = useMemo(() => {
    const r = from ? storeDateOnlyToUtcRange(from) : null
    return r ? r.dayStartUtc : undefined
  }, [from])
  const dateToUtc = useMemo(() => {
    const r = to ? storeDateOnlyToUtcRange(to) : null
    return r ? new Date(new Date(r.dayEndUtc).getTime() - 1).toISOString() : undefined
  }, [to])

  const query = useMemo(
    () => ({
      // An active search looks across every queue; clearing it returns to the
      // selected queue (the tabs stay visible so the queue is never lost).
      status: status === 'all' || debouncedQ ? undefined : status,
      search: debouncedQ || undefined,
      paymentMethod: method || undefined,
      paymentStatus: pstatus || undefined,
      dateFrom: dateFromUtc,
      dateTo: dateToUtc,
      cursor,
      limit: 25,
    }),
    [status, debouncedQ, method, pstatus, dateFromUtc, dateToUtc, cursor],
  )

  const { data, error, loading, reload } = useResource(() => {
    cursorAtFetch.current = cursor
    return client.listOrders(query)
  }, [query, refreshTick])

  // Merge fetched page into the accumulated list.
  useEffect(() => {
    if (!data) return
    setRows((prev) => {
      const base = cursorAtFetch.current === undefined ? [] : prev
      const seen = new Set(base.map((o) => o.id))
      return [...base, ...data.items.filter((o) => !seen.has(o.id))]
    })
  }, [data])

  const nextCursor = data?.nextCursor ?? null
  const loadingFirst = loading && rows.length === 0
  const loadingMore = loading && cursor !== undefined

  const activeFilterCount = (method ? 1 : 0) + (pstatus ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0)

  const clearFilters = () => {
    setMethod('')
    setPstatus('')
    setFrom('')
    setTo('')
  }

  // -- Row actions ---------------------------------------------------------

  const runAction = async (
    row: AdminOrderListItem,
    fn: (id: string) => Promise<{ status: string }>,
    successKey: DictKey,
  ) => {
    if (busyId) return
    setBusyId(row.id)
    setRowError(null)
    setFlash(null)
    try {
      await fn(row.id)
      setFlash(t(successKey))
      // client.* already fires bumpOrders → list refreshes via subscribeOrders.
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'unknown_error'
      if (code === 'invalid_order_transition') {
        setRowError(t('error.orderMovedByOther'))
        restartList()
      } else if (code === 'payment_state_conflict') {
        setRowError(t('error.paymentStateConflict'))
        restartList()
      } else {
        setRowError(t('error.generic'))
      }
    } finally {
      setBusyId(null)
    }
  }

  if (!canRead) {
    return (
      <AdminPage width="wide">
        <PageHeader title={t('orders.title')} description={t('orders.description')} />
        <Panel>
          <AdminEmpty
            icon={<ClipboardList size={22} aria-hidden="true" />}
            title={t('error.forbidden')}
          />
        </Panel>
      </AdminPage>
    )
  }

  const isSearching = debouncedQ.length > 0
  const displayQueue: Queue = isSearching ? 'all' : status

  return (
    <AdminPage width="wide">
      <PageHeader title={t('orders.title')} description={t('orders.description')} />

      {/* Queue tabs — while a search is active the visible selection is "الكل"
          (results span every queue); the chosen queue is kept and restored when
          the search clears. */}
      <div
        className="flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg border border-border bg-surface p-0.5"
        role="tablist"
        aria-label={t('orders.title')}
      >
        {QUEUES.map((queue) => {
          const selected = displayQueue === queue
          return (
            <button
              key={queue}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`lh-admin-hub-tab${selected ? ' lh-admin-hub-tab--active' : ''}`}
              onClick={() => {
                if (q) setQ('')
                setStatus(queue)
              }}
            >
              {t(QUEUE_LABEL_KEY[queue])}
            </button>
          )
        })}
      </div>

      {/* Search + filter trigger */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchField
            value={q}
            onChange={setQ}
            placeholder={t('orders.searchPlaceholder')}
            ariaLabel={t('orders.searchPlaceholder')}
          />
        </div>
        <Button
          variant="secondary"
          onClick={() => setFiltersOpen(true)}
          aria-label={t('orders.filters')}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          {t('orders.filters')}
          {activeFilterCount > 0 ? (
            <span className="lh-admin-chip lh-admin-chip--honey ms-1">{activeFilterCount}</span>
          ) : null}
        </Button>
      </div>

      {isSearching ? (
        <p className="lh-text-caption text-ink-3">{t('orders.search.allResults')}</p>
      ) : null}

      {activeFilterCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-3">{t('orders.filters.activeNote')}:</span>
          {method ? (
            <FilterPill
              label={`${t('orders.filters.paymentMethod')}: ${t('orders.method.cod')}`}
              onClear={() => setMethod('')}
            />
          ) : null}
          {pstatus ? (
            <FilterPill
              label={`${t('orders.filters.paymentStatus')}: ${
                pstatus === 'paid' ? t('orders.collect.collected') : t('orders.collect.pending')
              }`}
              onClear={() => setPstatus('')}
            />
          ) : null}
          {from ? (
            <FilterPill
              label={`${t('orders.filters.dateFrom')}: ${from}`}
              onClear={() => setFrom('')}
            />
          ) : null}
          {to ? (
            <FilterPill label={`${t('orders.filters.dateTo')}: ${to}`} onClear={() => setTo('')} />
          ) : null}
          <button type="button" className="lh-admin-link" onClick={clearFilters}>
            {t('orders.filters.clear')}
          </button>
        </div>
      ) : null}

      {flash ? <Flash tone="ok">{flash}</Flash> : null}
      {rowError ? <Flash tone="error">{rowError}</Flash> : null}
      {error && rows.length > 0 ? (
        <Flash tone="error">
          {errorMessage(error, t)}{' '}
          <button type="button" className="lh-admin-link" onClick={reload}>
            {t('common.retry')}
          </button>
        </Flash>
      ) : null}

      {loadingFirst ? (
        <Panel flush>
          <OrderRowsSkeleton />
          <OrderCardsSkeleton />
        </Panel>
      ) : error && rows.length === 0 ? (
        <ErrorState error={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <Panel>
          <AdminEmpty
            icon={<ClipboardList size={22} aria-hidden="true" />}
            title={isSearching ? t('orders.empty.search') : t(EMPTY_KEY[status])}
          />
        </Panel>
      ) : (
        <>
          {/* Mobile cards */}
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <OrderCard
                  row={row}
                  canWrite={canWrite}
                  canCancel={canCancel}
                  busy={busyId === row.id}
                  onStartDelivery={() =>
                    runAction(row, client.startOrderDelivery, 'orders.done.startDelivery')
                  }
                  onComplete={() => runAction(row, client.completeOrder, 'orders.done.complete')}
                  onCancel={() => setCancelFor(row)}
                />
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <Panel flush className="hidden lg:block">
            <div className="overflow-x-auto">
              <table className="lh-admin-table">
                <thead>
                  <tr>
                    <th>{t('orders.col.order')}</th>
                    <th>{t('orders.col.customer')}</th>
                    <th>{t('orders.col.location')}</th>
                    <th className="lh-admin-td-num">{t('orders.col.items')}</th>
                    <th className="lh-admin-td-num">{t('orders.col.total')}</th>
                    <th>{t('orders.col.payment')}</th>
                    <th>{t('orders.col.status')}</th>
                    <th className="min-w-[9.5rem] text-end">{t('orders.col.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link
                          href={`/admin/orders/${row.id}`}
                          className="lh-admin-link font-mono font-semibold"
                        >
                          {row.number}
                        </Link>
                        <div className="lh-admin-cell-sub">
                          {formatStoreDateTime(row.createdAt, locale)}
                        </div>
                      </td>
                      <td>
                        <div className="lh-admin-cell-title" dir="auto">
                          {row.customerName || '—'}
                        </div>
                        <div className="lh-admin-cell-sub text-ink-4" dir="ltr">
                          {formatPhone(row.customerPhone)}
                        </div>
                      </td>
                      <td className="text-ink-3" dir="auto">
                        {row.city ?? '—'}
                      </td>
                      <td className="lh-admin-td-num text-ink-2">
                        {formatCount(row.itemCount, locale)}
                      </td>
                      <td className="lh-admin-td-num font-bold text-ink">
                        {formatPrice(row.totalMinor, locale)}
                      </td>
                      <td className="text-xs">
                        <PaymentCell
                          method={row.paymentMethod}
                          status={row.paymentStatus}
                          orderStatus={row.status}
                        />
                      </td>
                      <td>
                        <OrderStatusChip status={row.status} />
                      </td>
                      <td className="min-w-[9.5rem] text-end align-middle">
                        <div className="flex flex-col items-end gap-1.5">
                          {canWrite && canAdvanceFulfillment(row) ? (
                            <NextActionButton
                              status={row.status}
                              pending={busyId === row.id}
                              disabled={busyId !== null && busyId !== row.id}
                              onStartDelivery={() =>
                                runAction(
                                  row,
                                  client.startOrderDelivery,
                                  'orders.done.startDelivery',
                                )
                              }
                              onComplete={() =>
                                runAction(row, client.completeOrder, 'orders.done.complete')
                              }
                            />
                          ) : null}
                          {canCancel && isCancellable(row) ? (
                            <button
                              type="button"
                              className="text-xs text-ink-3 transition-colors hover:text-danger"
                              onClick={() => setCancelFor(row)}
                            >
                              {t('orders.action.cancel')}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {nextCursor ? (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                loading={loadingMore}
                onClick={() => setCursor(nextCursor)}
              >
                {t('orders.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}

      {filtersOpen ? (
        <FiltersDialog
          onClose={() => setFiltersOpen(false)}
          method={method}
          pstatus={pstatus}
          from={from}
          to={to}
          onApply={(next) => {
            setMethod(next.method)
            setPstatus(next.pstatus)
            setFrom(next.from)
            setTo(next.to)
            setFiltersOpen(false)
          }}
          onClear={() => {
            clearFilters()
            setFiltersOpen(false)
          }}
        />
      ) : null}

      {cancelFor ? (
        <CancelOrderDialog
          order={{ id: cancelFor.id, number: cancelFor.number, status: cancelFor.status }}
          onClose={() => setCancelFor(null)}
          onConflict={() => {
            setCancelFor(null)
            restartList()
          }}
          onCancelled={(_result, restocked) => {
            setCancelFor(null)
            setFlash(
              restocked ? t('orders.done.cancelRestocked') : t('orders.done.cancelNoRestock'),
            )
            restartList()
          }}
        />
      ) : null}
    </AdminPage>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCancellable(row: {
  status: string
  paymentMethod: string
  paymentStatus: string
}): boolean {
  return (
    (row.status === 'processing' || row.status === 'delivering') &&
    row.paymentMethod === 'cod' &&
    row.paymentStatus === 'unpaid'
  )
}

function FilterPill({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-ink-2">
      {label}
      <button type="button" onClick={onClear} aria-label="clear" className="hover:text-danger">
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Mobile card
// ---------------------------------------------------------------------------

function OrderCard({
  row,
  canWrite,
  canCancel,
  busy,
  onStartDelivery,
  onComplete,
  onCancel,
}: {
  row: AdminOrderListItem
  canWrite: boolean
  canCancel: boolean
  busy: boolean
  onStartDelivery: () => void
  onComplete: () => void
  onCancel: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const pay = paymentPresentation(row.paymentMethod, row.paymentStatus, locale, row.status)

  return (
    <div className="lh-admin-record flex-col items-stretch gap-2">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/admin/orders/${row.id}`}
          className="lh-admin-link font-mono text-sm font-semibold"
        >
          {row.number}
        </Link>
        <span className="text-xs text-ink-4">{formatStoreTime(row.createdAt, locale)}</span>
      </div>

      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-ink" dir="auto">
          {row.customerName || '—'}
          {row.city ? <span className="font-normal text-ink-3"> · {row.city}</span> : null}
        </span>
        <OrderStatusChip status={row.status} />
      </div>

      {row.status === 'cancelled' &&
      row.paymentMethod === 'cod' &&
      row.inventoryRestoredOnCancel === false ? (
        <span className="w-fit rounded-full bg-warning-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-warning">
          {t('orders.return.pendingBadge')}
        </span>
      ) : null}

      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-ink-2">
          {t('orders.itemsCount', { n: formatCount(row.itemCount, locale) })} ·{' '}
          <span className="font-bold text-ink">{formatPrice(row.totalMinor, locale)}</span>
        </span>
        <span
          className={
            pay.tone === 'done' ? 'font-semibold text-success' : 'font-semibold text-warning'
          }
        >
          {pay.methodLabel} · {pay.stateLabel}
        </span>
      </div>

      {canWrite && canAdvanceFulfillment(row) ? (
        <NextActionButton
          status={row.status}
          size="lg"
          pending={busy}
          onStartDelivery={onStartDelivery}
          onComplete={onComplete}
        />
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <Link href={`/admin/orders/${row.id}`} className="lh-admin-link text-xs">
          {t('orders.viewDetails')}
        </Link>
        {canCancel && isCancellable(row) ? (
          <button
            type="button"
            className="shrink-0 text-xs text-ink-3 transition-colors hover:text-danger"
            onClick={onCancel}
          >
            {t('orders.action.cancel')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filters dialog (also the mobile sheet)
// ---------------------------------------------------------------------------

function FiltersDialog({
  onClose,
  method,
  pstatus,
  from,
  to,
  onApply,
  onClear,
}: {
  onClose: () => void
  method: string
  pstatus: string
  from: string
  to: string
  onApply: (next: { method: string; pstatus: string; from: string; to: string }) => void
  onClear: () => void
}) {
  const t = useT()
  // Mounted only while open (see caller), so plain initial state is the live
  // filter state — no effect sync needed.
  const [m, setM] = useState(method)
  const [ps, setPs] = useState(pstatus)
  const [f, setF] = useState(from)
  const [tt, setTt] = useState(to)

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('orders.filters.title')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClear}>
            {t('orders.filters.clear')}
          </Button>
          <Button onClick={() => onApply({ method: m, pstatus: ps, from: f, to: tt })}>
            {t('orders.filters.apply')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-ink-3">{t('orders.filters.paymentMethod')}</p>
          <Select value={m} onChange={(e) => setM(e.target.value)}>
            <option value="">{t('orders.filters.any')}</option>
            <option value="cod">{t('orders.method.cod')}</option>
          </Select>
        </section>

        <section className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-ink-3">{t('orders.filters.paymentStatus')}</p>
          <Select value={ps} onChange={(e) => setPs(e.target.value)}>
            <option value="">{t('orders.filters.any')}</option>
            <option value="unpaid">{t('orders.collect.pending')}</option>
            <option value="paid">{t('orders.collect.collected')}</option>
          </Select>
        </section>

        <section className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-ink-3">{t('orders.filters.date')}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('orders.filters.dateFrom')}>
              <Input
                type="date"
                dir="ltr"
                value={f}
                max={tt || undefined}
                onChange={(e) => setF(e.target.value)}
              />
            </Field>
            <Field label={t('orders.filters.dateTo')}>
              <Input
                type="date"
                dir="ltr"
                value={tt}
                min={f || undefined}
                onChange={(e) => setTt(e.target.value)}
              />
            </Field>
          </div>
          <p className="text-xs leading-relaxed text-ink-3">{t('orders.filters.dateNote')}</p>
        </section>
      </div>
    </Sheet>
  )
}
