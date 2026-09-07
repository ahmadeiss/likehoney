'use client'

import { AlertTriangle, ArrowRight, Search } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge, Button, Input, Select } from '@likehoney/ui'

import type { BadgeTone } from '@likehoney/ui'
import {
  PRODUCT_READINESS_HINTS,
  PRODUCT_READINESS_LABELS,
  SELLABILITY_HINTS,
  SELLABILITY_LABELS,
  type ProductReadiness,
  type Sellability,
} from '@likehoney/shared'

import {
  ApiError,
  type CustomerCard,
  type EntityStatus,
  type PageMeta,
  type ProductStatus,
  type StockLevel,
  type VariantStatus,
} from '../../../lib/admin/client'
import { useLocale, useT, type DictKey } from '../../../lib/admin/i18n'
import { formatPhone } from '../../../lib/admin/format'

export const DEFAULT_PAGE_SIZE = 20

// ---------------------------------------------------------------------------
// Status chips
// ---------------------------------------------------------------------------

const STATUS_TONE: Partial<Record<ProductStatus | VariantStatus | EntityStatus, BadgeTone>> = {
  active: 'success',
  inactive: 'neutral',
  draft: 'warning',
  archived: 'neutral',
}

const STATUS_LABEL: Record<string, Record<string, string>> = {
  active: { ar: 'نشط', en: 'Active' },
  inactive: { ar: 'غير نشط', en: 'Inactive' },
  draft: { ar: 'مسودة', en: 'Draft' },
  archived: { ar: 'مؤرشف', en: 'Archived' },
}

export function StatusBadge({ value }: { value: ProductStatus | VariantStatus | EntityStatus }) {
  const locale = useLocale()
  const text = STATUS_LABEL[value]?.[locale] ?? value
  return <Badge tone={STATUS_TONE[value] ?? 'neutral'}>{text}</Badge>
}

// ---------------------------------------------------------------------------
// Selling readiness — the shared, single derivation shown everywhere
// ---------------------------------------------------------------------------

const READINESS_TONE: Record<ProductReadiness, string> = {
  sellable: 'in',
  sellable_out: 'low',
  needs_setup: 'draft',
  draft: 'draft',
  inactive: 'inactive',
}

const SELLABILITY_TONE: Record<Sellability, string> = {
  sellable: 'in',
  out_of_stock: 'out',
  not_ready: 'draft',
  inactive: 'inactive',
}

/** Product-level "هل هذا المنتج جاهز للبيع؟" chip. */
export function ReadinessChip({ value }: { value: ProductReadiness }) {
  const locale = useLocale()
  return (
    <span
      className={`lh-admin-chip lh-admin-chip--${READINESS_TONE[value]}`}
      title={PRODUCT_READINESS_HINTS[value][locale]}
    >
      {PRODUCT_READINESS_LABELS[value][locale]}
    </span>
  )
}

/**
 * Physical stock pill — the one shape used on every surface. Reflects real
 * on-hand quantity only (`stockLevelFor` / `productStockLevelFor`), never
 * lifecycle: zero units is always "نافد".
 */
export function StockLevelPill({ level }: { level: StockLevel }) {
  const t = useT()
  return (
    <span className={`lh-stock-pill lh-stock-pill--${level}`}>
      {t(
        level === 'out'
          ? 'inventory.outOfStock'
          : level === 'low'
            ? 'inventory.lowStock'
            : 'inventory.available',
      )}
    </span>
  )
}

/**
 * Physical/reserved/available readout — Gate B4 Stage 5 (§28/§29/§31/§32).
 * Reservation is a real commercial hold for a pending electronic order, never
 * a physical deduction, so the physical count never changes because of it.
 * When nothing is reserved, this renders the exact same single-number
 * presentation every surface already used — no clutter for the common case.
 */
export function ReservedStockReadout({
  onHand,
  reserved,
  unitLabel,
}: {
  onHand: number
  reserved: number
  unitLabel?: string
}) {
  const t = useT()
  const locale = useLocale()
  const fmt = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US').format(n)

  if (reserved <= 0) {
    return (
      <span className="tabular-nums">
        {fmt(onHand)}
        {unitLabel ? ` ${unitLabel}` : ''}
      </span>
    )
  }

  const available = Math.max(0, onHand - reserved)
  return (
    <span className="flex flex-col items-end gap-0.5" title={t('inventory.reservedHint')}>
      <span className="tabular-nums">
        {fmt(onHand)}
        {unitLabel ? ` ${unitLabel}` : ''}
      </span>
      <span className="text-[0.6875rem] font-medium text-ink-3 tabular-nums">
        {t('inventory.reservedStock')}: {fmt(reserved)} · {t('inventory.availableToSell')}:{' '}
        {fmt(available)}
      </span>
    </span>
  )
}

/** Variant / option-level sellability chip. */
export function SellabilityChip({ value }: { value: Sellability }) {
  const locale = useLocale()
  return (
    <span
      className={`lh-admin-chip lh-admin-chip--${SELLABILITY_TONE[value]}`}
      title={SELLABILITY_HINTS[value][locale]}
    >
      {SELLABILITY_LABELS[value][locale]}
    </span>
  )
}

/** The one status-chip shape used across every admin screen. */
export function Chip({
  tone,
  children,
}: {
  tone:
    | 'active'
    | 'inactive'
    | 'draft'
    | 'archived'
    | 'in'
    | 'low'
    | 'out'
    | 'pending'
    | 'done'
    | 'honey'
    | 'danger'
  children: ReactNode
}) {
  return <span className={`lh-admin-chip lh-admin-chip--${tone}`}>{children}</span>
}

// ---------------------------------------------------------------------------
// Page scaffold
// ---------------------------------------------------------------------------

export function AdminPage({
  width = 'default',
  children,
}: {
  width?: 'default' | 'wide' | 'dash' | 'form' | 'report'
  children: ReactNode
}) {
  const mod =
    width === 'wide'
      ? ' lh-admin-page--wide'
      : width === 'dash'
        ? ' lh-admin-page--dash'
        : width === 'form'
          ? ' lh-admin-page--form'
          : width === 'report'
            ? ' lh-admin-page--report'
            : ''
  return <div className={`lh-admin-page${mod}`}>{children}</div>
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="lh-admin-page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="lh-admin-actions">{actions}</div> : null}
    </div>
  )
}

export function Panel({
  flush = false,
  plain = false,
  className = '',
  children,
}: {
  flush?: boolean
  plain?: boolean
  className?: string
  children: ReactNode
}) {
  const mod = plain ? ' lh-admin-panel--plain' : flush ? ' lh-admin-panel--flush' : ''
  return <section className={`lh-admin-panel${mod} ${className}`.trim()}>{children}</section>
}

export function PanelHead({
  title,
  sub,
  action,
}: {
  title: ReactNode
  sub?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="lh-admin-panel-head">
      <div>
        <div className="lh-admin-section-title">{title}</div>
        {sub ? <div className="lh-admin-section-sub">{sub}</div> : null}
      </div>
      {action}
    </div>
  )
}

export function SectionHead({
  title,
  sub,
  action,
}: {
  title: ReactNode
  sub?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="lh-admin-section-head">
      <div>
        <div className="lh-admin-section-title">{title}</div>
        {sub ? <div className="lh-admin-section-sub">{sub}</div> : null}
      </div>
      {action}
    </div>
  )
}

export function MoreLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) {
    return (
      <span className="lh-admin-link">
        {children}
        <ArrowRight size={14} aria-hidden="true" />
      </span>
    )
  }
  return (
    <Link className="lh-admin-link" href={href}>
      {children}
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Stat strip
// ---------------------------------------------------------------------------

export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="lh-admin-stat-strip lh-admin-reveal">{children}</div>
}

export function Stat({
  label,
  value,
  note,
  tone,
  href,
  icon,
  onClick,
  active,
}: {
  label: ReactNode
  value: ReactNode
  note?: ReactNode
  tone?: 'accent' | 'danger' | 'warning' | 'success'
  href?: string
  icon?: ReactNode
  /** Makes the tile an interactive in-page filter toggle instead of a plain readout. */
  onClick?: () => void
  active?: boolean
}) {
  const cls = `lh-admin-stat${tone ? ` lh-admin-stat--${tone}` : ''}${active ? ' lh-admin-stat--active' : ''}`
  const inner = (
    <>
      <span className="lh-admin-stat-label">
        {icon}
        {label}
      </span>
      <span className="lh-admin-stat-value">{value}</span>
      {note ? <span className="lh-admin-stat-note">{note}</span> : null}
    </>
  )
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-pressed={active === true}>
        {inner}
      </button>
    )
  }
  return href ? (
    <Link className={cls} href={href}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  )
}

// ---------------------------------------------------------------------------
// Filter toolbar + search field
// ---------------------------------------------------------------------------

/**
 * A toolbar `<select>` with a small visible label above it (Gate C §10) — an
 * unlabelled dropdown reading "الكل" gives the owner no idea what it filters.
 */
export function LabeledSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <label className="lh-admin-toolbar-field">
      <span className="lh-admin-field-label">{label}</span>
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </Select>
    </label>
  )
}

export function Toolbar({
  collapsible = false,
  children,
}: {
  collapsible?: boolean
  children: ReactNode
}) {
  return (
    <div className={`lh-admin-toolbar${collapsible ? ' lh-admin-toolbar--collapsible' : ''}`}>
      {children}
    </div>
  )
}

export function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel?: string
}) {
  return (
    <div className="lh-admin-toolbar-search">
      <Search size={15} aria-hidden="true" />
      <Input
        aria-label={ariaLabel ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty / coming soon / flash
// ---------------------------------------------------------------------------

export function AdminEmpty({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode
  title: ReactNode
  text?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="lh-admin-empty">
      <span className="lh-admin-empty-icon">{icon}</span>
      <span className="lh-admin-empty-title">{title}</span>
      {text ? <span className="lh-admin-empty-text">{text}</span> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

export function ComingSoon({
  tag,
  title,
  text,
}: {
  tag: ReactNode
  title: ReactNode
  text: ReactNode
}) {
  return (
    <div className="lh-admin-soon">
      <span className="lh-admin-soon-tag">{tag}</span>
      <span className="lh-admin-soon-title">{title}</span>
      <span className="lh-admin-soon-text">{text}</span>
    </div>
  )
}

export function Flash({ tone, children }: { tone: 'ok' | 'error'; children: ReactNode }) {
  return (
    <div
      className={`lh-admin-flash lh-admin-flash--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

export function RowSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-px bg-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 bg-surface p-4">
          <div className="lh-admin-skeleton size-8 rounded-md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="lh-admin-skeleton h-3 w-1/3 rounded" />
            <div className="lh-admin-skeleton h-2.5 w-1/5 rounded" />
          </div>
          <div className="lh-admin-skeleton h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

export function StripSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="lh-admin-stat-strip">
      {Array.from({ length: tiles }).map((_, i) => (
        <div key={i} className="lh-admin-stat">
          <div className="lh-admin-skeleton h-2.5 w-16 rounded" />
          <div className="lh-admin-skeleton h-7 w-20 rounded" />
          <div className="lh-admin-skeleton h-2 w-24 rounded" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

const ERROR_DICT_KEY: Record<string, DictKey> = {
  unauthorized: 'error.unauthorized',
  forbidden: 'error.forbidden',
  invalid: 'error.invalid',
  unprocessable: 'error.invalid',
  validation_error: 'error.validation',
  conflict: 'error.conflict',
  insufficient_stock: 'error.insufficientStock',
  invalid_order_transition: 'error.orderMovedByOther',
  order_already_cancelled: 'error.orderAlreadyCancelled',
  order_not_cancellable: 'error.orderNotCancellable',
  payment_state_conflict: 'error.paymentStateConflict',
  order_not_return_eligible: 'error.orderNotReturnEligible',
  return_quantity_exceeds_remaining: 'error.returnQuantityExceedsRemaining',
  return_idempotency_conflict: 'error.returnIdempotencyConflict',
  no_outstanding_return: 'error.noOutstandingReturn',
  payment_provider_not_configured: 'payments.blocker.payment_provider_not_configured',
  payment_provider_not_allowed: 'payments.blocker.payment_provider_not_allowed',
  payment_provider_unavailable: 'payments.blocker.payment_provider_unavailable',
  payment_infrastructure_not_ready: 'payments.blocker.payment_infrastructure_not_ready',
  not_found: 'error.notFound',
  network_error: 'error.network',
  internal_error: 'error.server',
  unknown_error: 'error.generic',
}

const VALIDATION_FIELD_LABEL: Record<string, { ar: string; en: string }> = {
  nameAr: { ar: 'اسم المنتج بالعربية', en: 'Product name (Arabic)' },
  nameEn: { ar: 'الاسم بالإنجليزية', en: 'Name (English)' },
  'pricing.priceMinor': { ar: 'السعر', en: 'Price' },
  supplierId: { ar: 'المورد', en: 'Supplier' },
  categoryId: { ar: 'التصنيف', en: 'Category' },
  descriptionAr: { ar: 'الوصف بالعربية', en: 'Description (Arabic)' },
  descriptionEn: { ar: 'الوصف بالإنجليزية', en: 'Description (English)' },
}

const VALIDATION_REASON: Record<string, { ar: string; en: string }> = {
  too_small: { ar: 'القيمة مطلوبة أو قصيرة جدًا', en: 'value required or too short' },
  invalid_format: { ar: 'صيغة غير صالحة', en: 'invalid format' },
  invalid_type: { ar: 'نوع غير صالح', en: 'invalid type' },
}

interface ValidationDetail {
  field?: string
  code?: string
  message?: string
}

function validationDetails(error: ApiError, t: (key: DictKey) => string): string {
  const details = Array.isArray(error.details) ? (error.details as ValidationDetail[]) : []
  if (details.length === 0) return t('error.validation')
  const lines = details.map((detail) => {
    const field = detail.field ?? ''
    const label = VALIDATION_FIELD_LABEL[field]
    const reason = VALIDATION_REASON[detail.code ?? ''] ?? { ar: detail.message ?? '', en: '' }
    if (label !== undefined) return `${label.ar}: ${reason.ar}`
    if (field.length > 0) return `${field}: ${reason.ar}`
    return reason.ar
  })
  return [t('error.validation'), ...lines].join('\n')
}

export function errorMessage(error: unknown, t: (key: DictKey) => string): string {
  if (error instanceof ApiError) {
    if (error.code === 'validation_error') return validationDetails(error, t)
    const dictKey = ERROR_DICT_KEY[error.code]
    if (dictKey !== undefined) return t(dictKey)
  }
  return t('error.generic')
}

export function ErrorState({
  error,
  onRetry,
  title,
}: {
  error: unknown
  onRetry?: () => void
  title?: string
}) {
  const t = useT()
  return (
    <div className="lh-admin-panel mx-auto flex max-w-md flex-col items-center gap-3 text-center">
      <div className="grid size-10 place-items-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle size={18} aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold text-ink">{title ?? t('error.generic')}</p>
        <p className="lh-text-caption text-ink-3">{errorMessage(error, t)}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export function Pagination({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  const t = useT()
  const total = Math.max(1, Math.ceil(meta.total / Math.max(meta.pageSize, 1)))
  const canPrevious = meta.page > 1
  const canNext = meta.page < total
  if (total <= 1) return null
  return (
    <nav
      aria-label={t('common.next')}
      className="flex flex-wrap items-center justify-between gap-2"
    >
      <span className="lh-text-caption text-ink-3">
        {t('common.resultsOf', { count: meta.total })}
      </span>
      <span className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!canPrevious}
          onClick={() => onPage(meta.page - 1)}
        >
          {t('common.previous')}
        </Button>
        <span className="lh-text-caption text-ink-3">
          {t('common.pageOf', { page: meta.page, total })}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={!canNext}
          onClick={() => onPage(meta.page + 1)}
        >
          {t('common.next')}
        </Button>
      </span>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Money input
// ---------------------------------------------------------------------------

export function MoneyInput({
  valueMinor,
  onChangeMinor,
  id,
  invalid,
}: {
  valueMinor: number
  onChangeMinor: (valueMinor: number) => void
  id?: string
  invalid?: boolean
}) {
  const locale = useLocale()
  const rawAmount = (valueMinor / 100).toFixed(2)
  return (
    <Input
      id={id}
      inputMode="numeric"
      dir="ltr"
      aria-label={locale === 'ar' ? 'المبلغ' : 'Amount'}
      value={rawAmount}
      invalid={invalid}
      onChange={(event) => {
        const cleaned = event.target.value.replace(/[^\d.]/g, '')
        const value = Math.trunc((Number.parseFloat(cleaned) || 0) * 100)
        onChangeMinor(value)
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Inline confirm
// ---------------------------------------------------------------------------

export function ConfirmInline({
  onConfirm,
  onCancel,
  label,
}: {
  onConfirm: () => void
  onCancel: () => void
  label: string
}) {
  const t = useT()
  return (
    <span className="inline-flex items-center gap-2">
      <span className="lh-text-caption">{label}</span>
      <Button variant="danger" size="sm" onClick={onConfirm}>
        {t('common.confirm')}
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Customer card — the linked internal CRM identity + new/returning badge.
// Shared by Order detail, Store-Sale detail, and the POS lookup preview.
// The new/returning classification is ALWAYS server-computed (`isReturning`).
// ---------------------------------------------------------------------------

export function CustomerReturningBadge({ isReturning }: { isReturning: boolean }) {
  const t = useT()
  return (
    <Badge tone={isReturning ? 'success' : 'neutral'}>
      {isReturning ? t('customerCard.returning') : t('customerCard.new')}
    </Badge>
  )
}

export function CustomerCardView({
  customer,
  href,
}: {
  customer: CustomerCard
  /** When set, the whole card links to Customer 360 (owner-only surface). */
  href?: string
}) {
  const t = useT()
  const locale = useLocale()
  const name =
    (locale === 'ar' ? customer.nameAr : customer.nameEn) ??
    customer.nameAr ??
    customer.nameEn ??
    t('customerCard.noName')
  const city = (locale === 'ar' ? customer.cityAr : customer.cityEn) ?? customer.cityAr
  const address = (locale === 'ar' ? customer.addressAr : customer.addressEn) ?? customer.addressAr

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-ink">{name}</span>
        <CustomerReturningBadge isReturning={customer.isReturning} />
      </div>
      <p dir="ltr" className="mt-1 text-start text-xs text-ink-3">
        {formatPhone(customer.phoneNormalized, { intl: true })}
      </p>
      {city || address ? (
        <p className="mt-0.5 text-xs text-ink-3" dir="auto">
          {[city, address].filter(Boolean).join(' — ')}
        </p>
      ) : null}
      {href ? (
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand">
          {t('customerCard.view360')}
          <ArrowRight size={13} className="rtl:rotate-180" aria-hidden="true" />
        </span>
      ) : null}
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-lg border border-border bg-surface p-3 transition hover:border-brand"
      >
        {body}
      </Link>
    )
  }
  return <div className="rounded-lg border border-border bg-surface p-3">{body}</div>
}
