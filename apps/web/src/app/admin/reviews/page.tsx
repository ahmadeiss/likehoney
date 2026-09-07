'use client'

import { ChevronLeft, Link2, MessageSquareText, Star } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMemo, type ReactElement } from 'react'

import { client } from '../../../lib/admin/client'
import { useAuth } from '../../../lib/admin/auth'
import { useResource } from '../../../lib/admin/hooks'
import { useLocale, useT, type DictKey } from '../../../lib/admin/i18n'
import { formatRelative } from '../../../lib/admin/format'
import {
  AdminEmpty,
  AdminPage,
  Chip,
  DEFAULT_PAGE_SIZE,
  ErrorState,
  PageHeader,
  Pagination,
  Panel,
  RowSkeleton,
} from '../_components/shared'

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all'
const STATUS_TONE: Record<'pending' | 'approved' | 'rejected', 'pending' | 'done' | 'danger'> = {
  pending: 'pending',
  approved: 'done',
  rejected: 'danger',
}
const STATUS_KEY: Record<'pending' | 'approved' | 'rejected', DictKey> = {
  pending: 'reviews.status.pending',
  approved: 'reviews.status.approved',
  rejected: 'reviews.status.rejected',
}
const FILTERS: { value: StatusFilter; key: DictKey }[] = [
  { value: 'pending', key: 'reviews.status.pending' },
  { value: 'approved', key: 'reviews.status.approved' },
  { value: 'rejected', key: 'reviews.status.rejected' },
  { value: 'all', key: 'reviews.filter.all' },
]

/** Read-only 1–5 star rendering — a real icon, never emoji. */
export function Stars({ value }: { value: number }): ReactElement {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={13}
          className={n <= value ? 'text-honey-600' : 'text-ink-4'}
          fill={n <= value ? 'currentColor' : 'none'}
          strokeWidth={2}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

export default function AdminReviewsPage(): ReactElement {
  const t = useT()
  const locale = useLocale()
  const { hasPermission } = useAuth()
  const canModerate = hasPermission('reviews:moderate')
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const page = useMemo(() => {
    const raw = sp.get('page')
    return raw && /^\d+$/.test(raw) ? Math.max(1, Number(raw)) : 1
  }, [sp])
  const status = (sp.get('status') as StatusFilter | null) ?? 'pending'

  const write = (next: { status?: StatusFilter; page?: number }) => {
    const params = new URLSearchParams()
    const s = next.status ?? status
    const p = next.page ?? (next.status ? 1 : page)
    if (s !== 'pending') params.set('status', s)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const { data, error, loading, reload } = useResource(
    () =>
      canModerate
        ? client.listReviews({ page, pageSize: DEFAULT_PAGE_SIZE, status })
        : Promise.resolve(null),
    [page, status, canModerate],
  )

  if (!canModerate) {
    return (
      <AdminPage>
        <PageHeader title={t('reviews.title')} description={t('reviews.description')} />
        <Panel>
          <AdminEmpty
            icon={<MessageSquareText size={22} aria-hidden="true" />}
            title={t('error.forbidden')}
            text={t('reviews.forbidden')}
          />
        </Panel>
      </AdminPage>
    )
  }

  const rows = data?.data ?? []
  const countFor = (v: StatusFilter): number | null => {
    if (!data) return null
    if (v === 'all') return data.counts.pending + data.counts.approved + data.counts.rejected
    return data.counts[v]
  }

  return (
    <AdminPage>
      <PageHeader title={t('reviews.title')} description={t('reviews.description')} />

      <section className="lh-admin-section">
        {/* Segmented status filter — moderation queue at a glance */}
        <div
          className="mb-4 flex flex-wrap gap-1.5"
          role="tablist"
          aria-label={t('reviews.filter.status')}
        >
          {FILTERS.map((f) => {
            const active = status === f.value
            const n = countFor(f.value)
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => write({ status: f.value })}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-ink bg-ink text-surface'
                    : 'border-border bg-surface text-ink-3 hover:border-ink-4 hover:text-ink'
                }`}
              >
                {t(f.key)}
                {n !== null ? (
                  <span
                    className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                      active ? 'bg-surface/25 text-surface' : 'bg-surface-muted text-ink-3'
                    }`}
                  >
                    {n}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        {loading && !data ? (
          <Panel flush>
            <RowSkeleton rows={6} />
          </Panel>
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <Panel>
            <AdminEmpty
              icon={<MessageSquareText size={22} aria-hidden="true" />}
              title={t('reviews.empty')}
            />
          </Panel>
        ) : (
          <>
            {/* Mobile cards */}
            <ul className="flex flex-col gap-2 md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/admin/reviews/${r.id}`}
                    className="lh-admin-record w-full text-start"
                  >
                    <span className="lh-admin-record-body">
                      <span className="lh-admin-record-title flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">{r.displayName}</span>
                        <Chip tone={STATUS_TONE[r.status]}>{t(STATUS_KEY[r.status])}</Chip>
                      </span>
                      <span className="lh-admin-record-meta flex items-center gap-2">
                        <Stars value={r.rating} />
                        <span aria-hidden="true">·</span>
                        <span>{formatRelative(r.createdAt, locale)}</span>
                        {r.verifiedPurchase ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <Chip tone="honey">{t('reviews.verified.yes')}</Chip>
                          </>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-ink-3" dir="auto">
                        {r.excerpt}
                      </span>
                    </span>
                    <ChevronLeft
                      size={15}
                      className="text-ink-4 shrink-0 rtl:rotate-180"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>

            {/* Desktop table */}
            <Panel flush className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="lh-admin-table">
                  <thead>
                    <tr>
                      <th className="w-[22%]">{t('reviews.col.name')}</th>
                      <th className="w-[100px]">{t('reviews.col.rating')}</th>
                      <th>{t('reviews.col.excerpt')}</th>
                      <th className="w-[130px]">{t('reviews.col.status')}</th>
                      <th className="w-[120px]">{t('reviews.col.verified')}</th>
                      <th className="w-[110px]">{t('reviews.col.submitted')}</th>
                      <th className="w-[1%]" aria-label={t('common.actions')} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span className="flex items-center gap-1.5 font-medium text-ink">
                            {r.displayName}
                            {r.hasLinkedCustomer ? (
                              <Link2
                                size={13}
                                className="text-ink-4"
                                aria-label={t('reviews.linkedCustomer')}
                              />
                            ) : null}
                          </span>
                        </td>
                        <td>
                          <Stars value={r.rating} />
                        </td>
                        <td className="max-w-xs truncate text-ink-2" dir="auto">
                          {r.excerpt}
                        </td>
                        <td>
                          <Chip tone={STATUS_TONE[r.status]}>{t(STATUS_KEY[r.status])}</Chip>
                        </td>
                        <td>
                          {r.verifiedPurchase ? (
                            <Chip tone="honey">{t('reviews.verified.yes')}</Chip>
                          ) : (
                            <span className="text-xs text-ink-4">{t('reviews.verified.no')}</span>
                          )}
                        </td>
                        <td className="text-ink-3">{formatRelative(r.createdAt, locale)}</td>
                        <td className="text-end">
                          <Link href={`/admin/reviews/${r.id}`} className="lh-admin-link">
                            {t('reviews.detail.title')}
                            <ChevronLeft size={14} className="rtl:rotate-180" aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            {data ? (
              <>
                <p className="mb-1 mt-3 text-xs font-semibold text-ink-3">
                  {t('common.resultsOf', { count: data.meta.total })}
                </p>
                <Pagination meta={data.meta} onPage={(p) => write({ page: p })} />
              </>
            ) : null}
          </>
        )}
      </section>
    </AdminPage>
  )
}
