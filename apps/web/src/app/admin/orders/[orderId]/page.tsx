'use client'

import { ArrowRight, ClipboardList } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

import { Button } from '@likehoney/ui'

import {
  ApiError,
  client,
  type AdminOrderDetail,
  type AdminOrderTimelineEntry,
} from '../../../../lib/admin/client'
import { useResource } from '../../../../lib/admin/hooks'
import { useAuth } from '../../../../lib/admin/auth'
import { useLocale, useT, type DictKey } from '../../../../lib/admin/i18n'
import {
  formatCount,
  formatPhone,
  formatPrice,
  formatStoreDateTime,
} from '../../../../lib/admin/format'
import {
  AdminEmpty,
  AdminPage,
  CustomerCardView,
  ErrorState,
  Flash,
  Panel,
  PanelHead,
} from '../../_components/shared'
import {
  canAdvanceFulfillment,
  Kv,
  NextActionButton,
  OrderStatusChip,
  paymentPresentation,
} from '../_components/order-ui'
import { CancelOrderDialog } from '../_components/cancel-dialog'
import { StockReturnDialog } from '../_components/stock-return-dialog'

const TIMELINE_LABEL: Record<AdminOrderTimelineEntry['type'], DictKey> = {
  created: 'orders.event.created',
  delivery_started: 'orders.event.deliveryStarted',
  completed: 'orders.event.completed',
  cancelled: 'orders.event.cancelled',
  stock_returned: 'orders.event.stockReturned',
}

export default function AdminOrderDetailPage() {
  const t = useT()
  const router = useRouter()
  const params = useParams<{ orderId: string }>()
  const orderId = params.orderId

  const { hasPermission } = useAuth()
  const canRead = hasPermission('orders:read')
  const canWrite = hasPermission('orders:write')
  const canCancel = hasPermission('orders:cancel')
  // Delayed physical stock-return reuses the EXISTING inventory-write
  // permission — never granted implicitly to every orders:write user.
  const canReturnStock = hasPermission('inventory:write')

  const {
    data: order,
    error,
    loading,
    reload,
  } = useResource(() => client.getOrder(orderId), [orderId], { revalidateOrders: true })

  const timeline = useResource(() => client.getOrderTimeline(orderId), [orderId], {
    revalidateOrders: true,
  })

  const [flash, setFlash] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)

  const refetch = useCallback(() => {
    reload()
    timeline.reload()
  }, [reload, timeline])

  const runAction = async (
    fn: (id: string) => Promise<{ status: string }>,
    successKey: DictKey,
  ) => {
    if (busy) return
    setBusy(true)
    setActionError(null)
    setFlash(null)
    try {
      await fn(orderId)
      setFlash(t(successKey))
      refetch()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'unknown_error'
      if (code === 'invalid_order_transition') {
        setActionError(t('error.orderMovedByOther'))
        refetch()
      } else if (code === 'payment_state_conflict') {
        setActionError(t('error.paymentStateConflict'))
        refetch()
      } else if (code === 'order_already_cancelled') {
        setActionError(t('error.orderAlreadyCancelled'))
        refetch()
      } else if (code === 'order_not_cancellable') {
        setActionError(t('error.orderNotCancellable'))
        refetch()
      } else {
        setActionError(t('error.generic'))
      }
    } finally {
      setBusy(false)
    }
  }

  if (!canRead) {
    return (
      <AdminPage width="wide">
        <Panel>
          <AdminEmpty
            icon={<ClipboardList size={22} aria-hidden="true" />}
            title={t('error.forbidden')}
          />
        </Panel>
      </AdminPage>
    )
  }

  return (
    <AdminPage width="wide">
      <button type="button" className="lh-admin-link mb-1 self-start" onClick={() => router.back()}>
        <ArrowRight size={14} className="rotate-180 rtl:rotate-0" aria-hidden="true" />
        {t('orders.detail.back')}
      </button>

      {loading && !order ? (
        <Panel>
          <div className="flex flex-col gap-3">
            <div className="lh-admin-skeleton h-7 w-40 rounded" />
            <div className="lh-admin-skeleton h-4 w-64 rounded" />
            <div className="lh-admin-skeleton h-40 w-full rounded" />
          </div>
        </Panel>
      ) : error && !order ? (
        error instanceof ApiError && error.status === 404 ? (
          <Panel>
            <AdminEmpty
              icon={<ClipboardList size={22} aria-hidden="true" />}
              title={t('orders.detail.notFound')}
              action={
                <Link href="/admin/orders" className="lh-admin-link">
                  {t('orders.detail.back')}
                </Link>
              }
            />
          </Panel>
        ) : (
          <ErrorState error={error} onRetry={refetch} />
        )
      ) : order ? (
        <>
          <OrderHeader
            order={order}
            canWrite={canWrite}
            canCancel={canCancel}
            busy={busy}
            onStartDelivery={() =>
              runAction(client.startOrderDelivery, 'orders.done.startDelivery')
            }
            onComplete={() => runAction(client.completeOrder, 'orders.done.complete')}
            onCancel={() => setCancelOpen(true)}
          />

          {flash ? <Flash tone="ok">{flash}</Flash> : null}
          {actionError ? <Flash tone="error">{actionError}</Flash> : null}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
            <div className="flex flex-col gap-6">
              <CustomerSection order={order} />
              <ItemsSection order={order} />
              {order.fulfillment.status === 'cancelled' ? (
                <StockReturnSection
                  order={order}
                  canReturnStock={canReturnStock}
                  onOpenDialog={() => setReturnOpen(true)}
                />
              ) : null}
              <ActivitySection
                entries={timeline.data ?? []}
                loading={timeline.loading && !timeline.data}
                error={timeline.error}
                onRetry={() => timeline.reload()}
              />
            </div>

            <aside className="flex flex-col gap-6">
              <DeliverySection order={order} />
              <PaymentSection order={order} />
              <FulfillmentSection order={order} entries={timeline.data ?? []} />
            </aside>
          </div>
        </>
      ) : null}

      {cancelOpen && order ? (
        <CancelOrderDialog
          order={{ id: order.id, number: order.number, status: order.fulfillment.status }}
          onClose={() => setCancelOpen(false)}
          onConflict={() => {
            setCancelOpen(false)
            refetch()
          }}
          onCancelled={(_result, restocked) => {
            setCancelOpen(false)
            setFlash(
              restocked ? t('orders.done.cancelRestocked') : t('orders.done.cancelNoRestock'),
            )
            refetch()
          }}
        />
      ) : null}

      {returnOpen && order ? (
        <StockReturnDialog
          order={order}
          onClose={() => setReturnOpen(false)}
          onRecorded={() => {
            setReturnOpen(false)
            setFlash(t('orders.return.done'))
            refetch()
          }}
        />
      ) : null}
    </AdminPage>
  )
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function OrderHeader({
  order,
  canWrite,
  canCancel,
  busy,
  onStartDelivery,
  onComplete,
  onCancel,
}: {
  order: AdminOrderDetail
  canWrite: boolean
  canCancel: boolean
  busy: boolean
  onStartDelivery: () => void
  onComplete: () => void
  onCancel: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const status = order.fulfillment.status
  const cancellable =
    (status === 'processing' || status === 'delivering') &&
    order.payment.method === 'cod' &&
    order.payment.status === 'unpaid'
  const pay = paymentPresentation(order.payment.method, order.payment.status, locale, status)
  const hasAction =
    canWrite &&
    canAdvanceFulfillment({
      status,
      paymentMethod: order.payment.method,
      paymentStatus: order.payment.status,
    })

  return (
    <header className="lh-order-hero">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-lg font-extrabold tracking-wide text-ink">
            {order.number}
          </span>
          <OrderStatusChip status={status} />
        </div>
        <div className="truncate text-sm font-semibold text-ink" dir="auto">
          {order.customer.name || '—'}
          {order.customer.city ? (
            <span className="font-normal text-ink-3"> · {order.customer.city}</span>
          ) : null}
        </div>
        <div className="lh-text-caption text-ink-3">
          {t('orders.event.created')}: {formatStoreDateTime(order.fulfillment.createdAt, locale)}
        </div>
        <div className="lh-text-caption">
          <span className="text-ink-2">{pay.methodLabel}</span>
          <span className="text-ink-4"> · </span>
          <span
            className={
              pay.tone === 'done' ? 'font-semibold text-success' : 'font-semibold text-warning'
            }
          >
            {pay.stateLabel}
          </span>
        </div>
      </div>

      {hasAction || (canCancel && cancellable) ? (
        <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
          {hasAction ? (
            <NextActionButton
              status={status}
              size="lg"
              pending={busy}
              onStartDelivery={onStartDelivery}
              onComplete={onComplete}
            />
          ) : null}
          {canCancel && cancellable ? (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {t('orders.action.cancel')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </header>
  )
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function CustomerSection({ order }: { order: AdminOrderDetail }) {
  const t = useT()
  const c = order.customer
  const address = [c.addressLine1, c.addressLine2].filter(Boolean).join('، ')
  return (
    <Panel flush>
      <PanelHead title={t('orders.detail.customer')} />
      <div className="px-5 pb-4">
        {order.customerAccount ? (
          <div className="mb-3">
            <CustomerCardView
              customer={order.customerAccount}
              href={`/admin/customers/${order.customerAccount.id}`}
            />
          </div>
        ) : (
          <p className="mb-3 text-xs text-ink-4">{t('customerCard.notLinked')}</p>
        )}
        <p className="mb-1.5 text-xs font-semibold text-ink-3">
          {t('orders.detail.customerSnapshot')}
        </p>
        <Kv k={t('orders.detail.customerName')}>{c.name || '—'}</Kv>
        <Kv k={t('orders.detail.customerPhone')}>
          {c.phone ? (
            <a href={`tel:${c.phone}`} className="lh-admin-link" dir="ltr">
              {formatPhone(c.phone, { intl: true })}
            </a>
          ) : (
            '—'
          )}
        </Kv>
        <Kv k={t('orders.detail.customerCity')}>{c.city ?? '—'}</Kv>
        <Kv k={t('orders.detail.customerAddress')}>{address || '—'}</Kv>
        {c.note ? <Kv k={t('orders.detail.customerNote')}>{c.note}</Kv> : null}
        {order.vendorNote ? <Kv k={t('orders.detail.vendorNote')}>{order.vendorNote}</Kv> : null}
      </div>
    </Panel>
  )
}

function DeliverySection({ order }: { order: AdminOrderDetail }) {
  const t = useT()
  const locale = useLocale()
  const d = order.delivery
  const zone = locale === 'ar' ? d.zoneNameAr : (d.zoneNameEn ?? d.zoneNameAr)
  return (
    <Panel flush>
      <PanelHead title={t('orders.detail.delivery')} />
      <div className="px-5 pb-4">
        <Kv k={t('orders.detail.deliveryZone')}>{zone ?? d.zoneCode ?? '—'}</Kv>
        <Kv k={t('orders.detail.deliveryFee')}>{formatPrice(d.feeMinor, locale)}</Kv>
      </div>
    </Panel>
  )
}

function ItemsSection({ order }: { order: AdminOrderDetail }) {
  const t = useT()
  const locale = useLocale()
  const tax = order.totals.taxMinor
  return (
    <Panel flush>
      <PanelHead title={t('orders.detail.items')} />
      <ul className="flex flex-col">
        {order.items.map((item) => {
          const name = locale === 'ar' ? item.productNameAr : item.productNameEn
          const label = locale === 'ar' ? item.variantLabelAr : item.variantLabelEn
          return (
            <li
              key={item.variantId}
              className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug text-ink" dir="auto">
                  {name}
                  {label ? <span className="font-normal text-ink-2"> — {label}</span> : null}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
                  <span className="font-mono text-[0.6875rem] text-ink-4">{item.sku}</span>
                  <span aria-hidden="true" className="text-ink-4">
                    ·
                  </span>
                  <span className="tabular-nums">
                    {formatCount(item.quantity, locale)} ×{' '}
                    {formatPrice(item.unitPriceMinor, locale)}
                  </span>
                </p>
              </div>
              <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
                {formatPrice(item.lineTotalMinor, locale)}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="border-t border-border px-5 py-4">
        <Kv k={t('orders.detail.subtotal')}>{formatPrice(order.totals.subtotalMinor, locale)}</Kv>
        <Kv k={t('orders.detail.deliveryFee')}>
          {formatPrice(order.totals.deliveryFeeMinor, locale)}
        </Kv>
        {tax > 0 ? <Kv k={t('orders.detail.tax')}>{formatPrice(tax, locale)}</Kv> : null}
        <div className="mt-2 flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm font-semibold text-ink-2">{t('orders.detail.grandTotal')}</span>
          <span className="font-mono text-lg font-extrabold tabular-nums text-ink">
            {formatPrice(order.totals.totalMinor, locale)}
          </span>
        </div>
      </div>
    </Panel>
  )
}

function PaymentSection({ order }: { order: AdminOrderDetail }) {
  const t = useT()
  const locale = useLocale()
  const p = paymentPresentation(
    order.payment.method,
    order.payment.status,
    locale,
    order.fulfillment.status,
  )
  const isElectronic = order.payment.method === 'electronic'

  // The order-lifecycle status alone never distinguishes "cancelled by
  // staff" from "cancelled by the system after payment expired" — but a
  // `cancelled` electronic order can only ever reach `paymentStatus ===
  // 'expired'` via the authoritative payment-expiry path (§23; a staff
  // cancellation is COD-only and never sets this combination).
  const isSystemExpiry = isElectronic && order.payment.status === 'expired'

  return (
    <Panel flush>
      <PanelHead title={t('orders.detail.payment')} />
      <div className="px-5 pb-4">
        <Kv k={t('orders.payment.method')}>{p.methodLabel}</Kv>
        <Kv k={t('orders.payment.status')}>
          <span className={p.tone === 'done' ? 'text-success' : 'text-warning'}>
            {p.stateLabel}
          </span>
        </Kv>
      </div>

      {isElectronic ? (
        <div className="border-t border-border px-5 py-4">
          {order.payment.status === 'pending' ? (
            <p className="text-xs leading-relaxed text-ink-3">
              {t('orders.payment.electronicPendingNote')}
            </p>
          ) : order.payment.status === 'paid' ? (
            <p className="text-xs leading-relaxed text-ink-3">
              {t('orders.payment.electronicPaidNote')}
            </p>
          ) : isSystemExpiry ? (
            <p className="text-xs leading-relaxed text-ink-3">
              {t('orders.payment.electronicExpiredNote')}
            </p>
          ) : null}

          <p className="mt-2 text-xs font-medium text-ink-4">
            {order.payment.status === 'paid' &&
            (order.fulfillment.status === 'processing' || order.fulfillment.status === 'delivering')
              ? t('orders.payment.electronicPaidFulfillmentNote')
              : t('orders.payment.noActionElectronic')}
          </p>
        </div>
      ) : null}
    </Panel>
  )
}

function FulfillmentSection({
  order,
  entries,
}: {
  order: AdminOrderDetail
  entries: AdminOrderTimelineEntry[]
}) {
  const t = useT()
  const locale = useLocale()
  const f = order.fulfillment
  const cancelledEntry = entries.find((e) => e.type === 'cancelled')
  const cancelledBy =
    cancelledEntry?.actor &&
    (locale === 'ar'
      ? cancelledEntry.actor.nameAr
      : (cancelledEntry.actor.nameEn ?? cancelledEntry.actor.nameAr))

  return (
    <Panel flush>
      <PanelHead title={t('orders.detail.fulfillment')} />
      <div className="px-5 pb-4">
        <Kv k={t('orders.event.created')}>{formatStoreDateTime(f.createdAt, locale)}</Kv>
        {f.deliveringAt ? (
          <Kv k={t('orders.event.deliveryStarted')}>
            {formatStoreDateTime(f.deliveringAt, locale)}
          </Kv>
        ) : null}
        {f.completedAt ? (
          <Kv k={t('orders.event.completed')}>{formatStoreDateTime(f.completedAt, locale)}</Kv>
        ) : null}
        {f.cancelledAt ? (
          <Kv k={t('orders.cancelled.at')}>{formatStoreDateTime(f.cancelledAt, locale)}</Kv>
        ) : null}

        {f.status === 'cancelled' ? (
          <>
            {cancelledBy ? <Kv k={t('orders.cancelled.by')}>{cancelledBy}</Kv> : null}
            {f.cancelledReason ? (
              <Kv k={t('orders.cancelled.reason')}>{f.cancelledReason}</Kv>
            ) : null}
            {f.inventoryRestoredOnCancel === true ? (
              <p className="mt-3 rounded-md bg-success-soft px-3 py-2 text-xs font-semibold text-success">
                {t('orders.cancelled.restockedYes')}
              </p>
            ) : f.inventoryRestoredOnCancel === false ? (
              <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">
                {t('orders.cancelled.restockedNo')}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Panel>
  )
}

function StockReturnSection({
  order,
  canReturnStock,
  onOpenDialog,
}: {
  order: AdminOrderDetail
  canReturnStock: boolean
  onOpenDialog: () => void
}) {
  const t = useT()
  const locale = useLocale()

  const returnLines = order.items.filter(
    (
      i,
    ): i is AdminOrderDetail['items'][number] & {
      stockReturn: NonNullable<AdminOrderDetail['items'][number]['stockReturn']>
    } => i.stockReturn !== null,
  )
  if (returnLines.length === 0) return null

  const totalRemaining = returnLines.reduce(
    (sum, i) => sum + i.stockReturn.remainingReturnableQuantity,
    0,
  )
  const fullyRestored = totalRemaining === 0
  const hasReceipts = order.stockReturns.length > 0
  const outstandingLines = returnLines.filter((i) => i.stockReturn.remainingReturnableQuantity > 0)

  return (
    <Panel flush>
      <PanelHead title={t('orders.return.sectionTitle')} />
      <div className="px-5 pb-4">
        {fullyRestored ? (
          <p className="rounded-md bg-success-soft px-3 py-2.5 text-xs font-semibold leading-relaxed text-success">
            {t('orders.return.fullyRestored')}
          </p>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-ink-2" dir="auto">
              {hasReceipts ? t('orders.return.partialIntro') : t('orders.return.outstandingIntro')}
            </p>

            <ul className="mt-3 flex flex-col gap-2">
              {outstandingLines.map((item) => {
                const name = locale === 'ar' ? item.productNameAr : item.productNameEn
                return (
                  <li
                    key={item.orderItemId}
                    className="flex items-center justify-between gap-3 rounded-md bg-warning-soft px-3 py-2 text-xs"
                  >
                    <span className="min-w-0 truncate font-medium text-ink" dir="auto">
                      {name}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-warning">
                      {t('orders.return.lineRemaining')}:{' '}
                      {formatCount(item.stockReturn.remainingReturnableQuantity, locale)}
                    </span>
                  </li>
                )
              })}
            </ul>

            {canReturnStock ? (
              <Button variant="primary" size="sm" className="mt-3.5 w-full" onClick={onOpenDialog}>
                {t('orders.return.action')}
              </Button>
            ) : null}
          </>
        )}

        {hasReceipts ? (
          <div className="mt-4 border-t border-border pt-3.5">
            <p className="lh-text-caption mb-2 text-ink-3">{t('orders.return.receiptsTitle')}</p>
            <ul className="flex flex-col gap-2.5">
              {order.stockReturns.map((receipt) => {
                const receivedByName =
                  receipt.receivedBy &&
                  (locale === 'ar'
                    ? receipt.receivedBy.nameAr
                    : (receipt.receivedBy.nameEn ?? receipt.receivedBy.nameAr))
                const totalQty = receipt.lines.reduce((sum, l) => sum + l.quantity, 0)
                return (
                  <li key={receipt.id} className="text-xs">
                    <p className="font-medium text-ink" dir="auto">
                      {t('orders.event.stockReturnedQty', { n: String(totalQty) })}
                    </p>
                    <p className="text-ink-3">
                      {formatStoreDateTime(receipt.createdAt, locale)}
                      {receivedByName
                        ? ` · ${t('orders.return.receiptBy', { name: receivedByName })}`
                        : ''}
                    </p>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  )
}

function ActivitySection({
  entries,
  loading,
  error,
  onRetry,
}: {
  entries: AdminOrderTimelineEntry[]
  loading: boolean
  error: ApiError | null
  onRetry: () => void
}) {
  const t = useT()
  const locale = useLocale()

  return (
    <Panel flush>
      <PanelHead title={t('orders.detail.activity')} />
      {loading ? (
        <div className="px-5 py-4">
          <div className="lh-admin-skeleton h-4 w-40 rounded" />
        </div>
      ) : error ? (
        <div className="px-5 py-4">
          <ErrorState error={error} onRetry={onRetry} />
        </div>
      ) : entries.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-3">{t('orders.timeline.empty')}</p>
      ) : (
        <ul className="lh-admin-activity">
          {entries.map((entry, i) => {
            const actor =
              entry.actor &&
              (locale === 'ar' ? entry.actor.nameAr : (entry.actor.nameEn ?? entry.actor.nameAr))
            const dotMod =
              entry.type === 'completed'
                ? ' lh-admin-activity-dot--in'
                : entry.type === 'cancelled'
                  ? ' lh-admin-activity-dot--out'
                  : ''
            return (
              <li key={`${entry.type}-${i}`} className="lh-admin-activity-item">
                <span className={`lh-admin-activity-dot${dotMod}`} aria-hidden="true" />
                <div>
                  <div className="lh-admin-activity-text">
                    {entry.type === 'stock_returned' && entry.meta?.quantity !== undefined
                      ? t('orders.event.stockReturnedQty', { n: String(entry.meta.quantity) })
                      : t(TIMELINE_LABEL[entry.type])}
                    {entry.type === 'cancelled' && entry.meta?.restocked !== undefined ? (
                      <span className="text-ink-3">
                        {' — '}
                        {entry.meta.restocked
                          ? t('orders.event.restocked')
                          : t('orders.event.notRestocked')}
                      </span>
                    ) : null}
                  </div>
                  <div className="lh-admin-activity-meta">
                    {formatStoreDateTime(entry.at, locale)}
                    {actor ? ` · ${t('orders.event.by', { name: actor })}` : ''}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
