'use client'

import { useEffect, useState, type ReactNode } from 'react'

import { Button } from '@likehoney/ui'
import {
  COD_COLLECTION_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type Locale,
} from '@likehoney/shared'

import { useLocale, useT } from '../../../../lib/admin/i18n'

// ---------------------------------------------------------------------------
// Small shared hooks
// ---------------------------------------------------------------------------

/** Debounce a value so search doesn't fire on every keystroke. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

type ChipTone = 'pending' | 'honey' | 'done' | 'inactive'

/**
 * Restrained operational tones — amber (needs work), honey (in transit), green
 * (done), muted grey (closed). Never red: a cancelled order is a closed record,
 * not an error.
 */
const STATUS_TONE: Record<string, ChipTone> = {
  processing: 'pending',
  delivering: 'honey',
  completed: 'done',
  cancelled: 'inactive',
}

export function orderStatusLabel(status: string, locale: Locale): string {
  const entry = (ORDER_STATUS_LABELS as Record<string, { ar: string; en: string }>)[status]
  return entry ? entry[locale] : status
}

export function OrderStatusChip({ status }: { status: string }) {
  const locale = useLocale()
  const tone = STATUS_TONE[status] ?? 'inactive'
  return (
    <span className={`lh-admin-chip lh-admin-chip--${tone}`}>
      {orderStatusLabel(status, locale)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Payment presentation — deliberately generic so B4 electronic states slot in
// without a rewrite. For COD the second line is a *collection* state, never
// "unpaid / payment failed".
// ---------------------------------------------------------------------------

export interface PaymentPresentation {
  methodLabel: string
  stateLabel: string
  tone: 'done' | 'pending'
}

export function paymentPresentation(
  method: string,
  status: string,
  locale: Locale,
  orderStatus?: string,
): PaymentPresentation {
  const methodEntry = (PAYMENT_METHOD_LABELS as Record<string, { ar: string; en: string }>)[method]
  const methodLabel = methodEntry ? methodEntry[locale] : method
  const collected = status === 'paid'

  if (method === 'cod') {
    // A cancelled unpaid COD order will never be collected — "لم يُحصّل بعد"
    // wrongly implies a pending future collection, so read it as closed.
    const pendingLabel =
      orderStatus === 'cancelled'
        ? { ar: 'لم يتم التحصيل', en: 'Not collected' }[locale]
        : COD_COLLECTION_LABELS.pending[locale]
    return {
      methodLabel,
      stateLabel: collected ? COD_COLLECTION_LABELS.collected[locale] : pendingLabel,
      tone: collected ? 'done' : 'pending',
    }
  }

  const statusEntry = (PAYMENT_STATUS_LABELS as Record<string, { ar: string; en: string }>)[status]
  return {
    methodLabel,
    stateLabel: statusEntry ? statusEntry[locale] : status,
    tone: collected ? 'done' : 'pending',
  }
}

/** Two-line payment cell: method on top, collection/settlement state below. */
export function PaymentCell({
  method,
  status,
  orderStatus,
}: {
  method: string
  status: string
  orderStatus?: string
}) {
  const locale = useLocale()
  const p = paymentPresentation(method, status, locale, orderStatus)
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-ink-2">{p.methodLabel}</span>
      <span
        className={`text-xs font-semibold ${p.tone === 'done' ? 'text-success' : 'text-warning'}`}
      >
        {p.stateLabel}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Fulfillment-action eligibility — final pre-provider correction. The backend
// (`start-delivery` / `complete`) accepts a COD order in `processing` or
// `delivering` regardless of payment status (COD is always unpaid until
// completion), OR an electronic order that has already been paid — an
// electronic order still `pending` (or `expired`/`cancelled`) can never
// advance. The UI mirrors the API's own rule exactly; the API remains
// independently authoritative and rejects anything this getter would miss.
// ---------------------------------------------------------------------------

export function canAdvanceFulfillment(row: {
  status: string
  paymentMethod: string
  paymentStatus: string
}): boolean {
  if (row.status !== 'processing' && row.status !== 'delivering') return false
  if (row.paymentMethod === 'cod') return true
  return row.paymentMethod === 'electronic' && row.paymentStatus === 'paid'
}

// ---------------------------------------------------------------------------
// Next action — the page tells the employee what to DO. Not a status dropdown.
// ---------------------------------------------------------------------------

export function NextActionButton({
  status,
  pending,
  disabled,
  size = 'sm',
  onStartDelivery,
  onComplete,
}: {
  status: string
  pending?: boolean
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
  onStartDelivery: () => void
  onComplete: () => void
}) {
  const t = useT()
  if (status === 'processing') {
    return (
      <Button size={size} loading={pending} disabled={disabled} onClick={onStartDelivery}>
        {pending ? t('orders.action.pending') : t('orders.action.startDelivery')}
      </Button>
    )
  }
  if (status === 'delivering') {
    return (
      <Button size={size} loading={pending} disabled={disabled} onClick={onComplete}>
        {pending ? t('orders.action.pending') : t('orders.action.complete')}
      </Button>
    )
  }
  return null
}

// ---------------------------------------------------------------------------
// Skeletons — aligned with the final row / card shapes, no layout jump.
// ---------------------------------------------------------------------------

export function OrderRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="hidden flex-col gap-px bg-border lg:flex">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[1.4fr_1.4fr_1fr_0.6fr_0.9fr_1fr_0.9fr_1fr] items-center gap-3 bg-surface p-4"
        >
          <div className="flex flex-col gap-1.5">
            <div className="lh-admin-skeleton h-3 w-20 rounded" />
            <div className="lh-admin-skeleton h-2.5 w-12 rounded" />
          </div>
          <div className="lh-admin-skeleton h-3 w-24 rounded" />
          <div className="lh-admin-skeleton h-3 w-16 rounded" />
          <div className="lh-admin-skeleton h-3 w-8 rounded" />
          <div className="lh-admin-skeleton h-3 w-14 rounded" />
          <div className="lh-admin-skeleton h-3 w-16 rounded" />
          <div className="lh-admin-skeleton h-5 w-16 rounded-full" />
          <div className="lh-admin-skeleton h-8 w-20 rounded-md" />
        </div>
      ))}
    </div>
  )
}

export function OrderCardsSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:hidden">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="lh-admin-record flex-col items-stretch gap-3">
          <div className="flex items-center justify-between">
            <div className="lh-admin-skeleton h-3 w-20 rounded" />
            <div className="lh-admin-skeleton h-5 w-16 rounded-full" />
          </div>
          <div className="lh-admin-skeleton h-3 w-32 rounded" />
          <div className="lh-admin-skeleton h-3 w-24 rounded" />
          <div className="lh-admin-skeleton h-9 w-full rounded-md" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Key / value row for the detail document
// ---------------------------------------------------------------------------

export function Kv({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="lh-admin-kv">
      <span className="lh-admin-kv-key">{k}</span>
      <span className="lh-admin-kv-val" dir="auto">
        {children}
      </span>
    </div>
  )
}
