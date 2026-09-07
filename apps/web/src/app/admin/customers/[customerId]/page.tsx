'use client'

import { ArrowRight, Contact } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@likehoney/ui'

import { client } from '../../../../lib/admin/client'
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
  ErrorState,
  PageHeader,
  Panel,
  RowSkeleton,
  StatusBadge,
} from '../../_components/shared'

const ORDER_STATUS_LABEL: Record<'processing' | 'delivering' | 'completed' | 'cancelled', DictKey> =
  {
    processing: 'orders.queue.processing',
    delivering: 'orders.queue.delivering',
    completed: 'orders.queue.completed',
    cancelled: 'orders.queue.cancelled',
  }

export default function Customer360Page() {
  const { customerId } = useParams<{ customerId: string }>()
  const t = useT()
  const locale = useLocale()
  const { hasPermission } = useAuth()
  const canRead = hasPermission('customers:read')
  const [busy, setBusy] = useState(false)

  const { data, error, loading, reload } = useResource(
    () => (canRead ? client.getCustomer360(customerId) : Promise.resolve(null)),
    [customerId, canRead],
  )

  if (!canRead) {
    return (
      <AdminPage>
        <PageHeader title={t('customers.360Title')} />
        <Panel>
          <AdminEmpty
            icon={<Contact size={22} aria-hidden="true" />}
            title={t('error.forbidden')}
            text={t('customers.forbidden')}
          />
        </Panel>
      </AdminPage>
    )
  }

  const toggleStatus = async () => {
    if (!data || busy) return
    setBusy(true)
    try {
      await client.setCustomerStatus(data.id, data.status === 'active' ? 'inactive' : 'active')
      reload()
    } finally {
      setBusy(false)
    }
  }

  const name =
    data === null
      ? ''
      : ((locale === 'ar' ? data.nameAr : data.nameEn) ??
        data.nameAr ??
        data.nameEn ??
        t('customers.noName'))
  const city = data && ((locale === 'ar' ? data.cityAr : data.cityEn) ?? data.cityAr)
  const address = data && ((locale === 'ar' ? data.addressAr : data.addressEn) ?? data.addressAr)

  return (
    <AdminPage>
      <Link href="/admin/customers" className="lh-admin-link mb-3 inline-flex">
        <ArrowRight size={14} className="rotate-180 rtl:rotate-0" aria-hidden="true" />
        {t('customers.back')}
      </Link>

      {loading && !data ? (
        <Panel flush>
          <RowSkeleton rows={6} />
        </Panel>
      ) : error || !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="flex flex-col gap-5">
          <PageHeader
            title={name}
            description={formatPhone(data.phoneNormalized, { intl: true })}
            actions={
              <Button variant="secondary" size="sm" loading={busy} onClick={toggleStatus}>
                {data.status === 'active' ? t('customers.archive') : t('customers.unarchive')}
              </Button>
            }
          />

          {/* Current profile */}
          <section className="lh-admin-section">
            <h2 className="lh-admin-section-title mb-2">{t('customers.section.profile')}</h2>
            <Panel>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t('customers.field.phone')}>
                  <span dir="ltr">{formatPhone(data.phoneNormalized, { intl: true })}</span>
                </Field>
                <Field label={t('customers.colStatus')}>
                  <StatusBadge value={data.status} />
                </Field>
                <Field label={t('customers.field.city')}>{city || '—'}</Field>
                <Field label={t('customers.field.address')}>{address || '—'}</Field>
                <Field label={t('customers.field.firstSeen')}>
                  {data.firstSeenAt ? formatStoreDateTime(data.firstSeenAt, locale) : '—'}
                </Field>
                <Field label={t('customers.field.lastSeen')}>
                  {data.lastSeenAt ? formatStoreDateTime(data.lastSeenAt, locale) : '—'}
                </Field>
                <Field label={t('customers.field.consent')}>
                  {data.consentToContact ? t('customers.consentYes') : t('customers.consentNo')}
                </Field>
                {data.note ? (
                  <Field label={t('customers.field.note')}>
                    <span dir="auto">{data.note}</span>
                  </Field>
                ) : null}
              </dl>
              <p className="mt-3 text-xs text-ink-4">{t('customers.archiveHint')}</p>
            </Panel>
          </section>

          {/* Commercial summary */}
          <section className="lh-admin-section">
            <h2 className="lh-admin-section-title mb-2">{t('customers.section.commercial')}</h2>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              <Metric
                label={t('customers.metric.lifetimeSpend')}
                value={formatPrice(data.commercial.lifetimeSpendMinor, locale)}
                hint={t('customers.spendHint')}
              />
              <Metric
                label={t('customers.metric.completedOrders')}
                value={formatCount(data.commercial.completedOrdersCount, locale)}
                hint={t('customers.completedHint')}
              />
              <Metric
                label={t('customers.metric.completedSales')}
                value={formatCount(data.commercial.completedSalesCount, locale)}
              />
              <Metric
                label={t('customers.metric.firstTx')}
                value={
                  data.commercial.firstTransactionAt
                    ? formatStoreDateTime(data.commercial.firstTransactionAt, locale)
                    : '—'
                }
              />
              <Metric
                label={t('customers.metric.lastTx')}
                value={
                  data.commercial.lastTransactionAt
                    ? formatStoreDateTime(data.commercial.lastTransactionAt, locale)
                    : '—'
                }
              />
            </div>
          </section>

          {/* Cross-channel timeline */}
          <section className="lh-admin-section">
            <h2 className="lh-admin-section-title mb-2">{t('customers.section.timeline')}</h2>
            {data.timeline.length === 0 ? (
              <Panel>
                <AdminEmpty
                  icon={<Contact size={20} aria-hidden="true" />}
                  title={t('customers.timelineEmpty')}
                />
              </Panel>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.timeline.map((tx) => {
                  const href =
                    tx.channel === 'online'
                      ? `/admin/orders/${tx.id}`
                      : `/admin/store-sales?sale=${tx.id}`
                  return (
                    <li key={`${tx.channel}-${tx.id}`}>
                      <Link href={href} className="lh-admin-record w-full text-start">
                        <span className="lh-admin-record-body">
                          <span className="lh-admin-record-title flex items-center gap-2 font-mono">
                            {tx.number}
                            <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-3">
                              {tx.channel === 'online'
                                ? t('customers.channel.online')
                                : t('customers.channel.store')}
                            </span>
                          </span>
                          <span className="lh-admin-record-meta">
                            <span>{formatStoreDateTime(tx.createdAt, locale)}</span>
                            {tx.status ? (
                              <>
                                <span>·</span>
                                <span>{t(ORDER_STATUS_LABEL[tx.status])}</span>
                              </>
                            ) : null}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-ink">
                          {formatPrice(tx.totalMinor, locale)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </AdminPage>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  )
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="mt-1 font-mono text-base font-bold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-tight text-ink-4">{hint}</p> : null}
    </div>
  )
}
