'use client'

import { ChevronLeft, Contact } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { client, type EntityStatus } from '../../../lib/admin/client'
import { useResource } from '../../../lib/admin/hooks'
import { useAuth } from '../../../lib/admin/auth'
import { useLocale, useT } from '../../../lib/admin/i18n'
import { formatPhone, formatRelative } from '../../../lib/admin/format'
import {
  AdminEmpty,
  AdminPage,
  DEFAULT_PAGE_SIZE,
  ErrorState,
  LabeledSelect,
  PageHeader,
  Pagination,
  Panel,
  RowSkeleton,
  SearchField,
  StatusBadge,
  Toolbar,
} from '../_components/shared'

type Channel = 'online' | 'store' | 'both'
type CustType = 'new' | 'returning' | 'no_purchase'
const INACTIVE_DAYS = [30, 60, 90, 180, 365]

/** All directory filters live in the URL (§4) so refresh / back-forward /
 *  copy-link preserve them. Changing any filter resets the page to 1. */
interface DirState {
  page: number
  search: string
  region: string
  status: EntityStatus | ''
  channel: Channel | ''
  type: CustType | ''
  inactiveDays: number | ''
}

function readDir(sp: URLSearchParams): DirState {
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : '')
  return {
    page: num(sp.get('page')) || 1,
    search: sp.get('search') ?? '',
    region: sp.get('region') ?? '',
    status: (sp.get('status') as EntityStatus | null) ?? '',
    channel: (sp.get('channel') as Channel | null) ?? '',
    type: (sp.get('type') as CustType | null) ?? '',
    inactiveDays: num(sp.get('inactiveDays')),
  }
}

export default function AdminCustomersPage() {
  const t = useT()
  const locale = useLocale()
  const { hasPermission } = useAuth()
  const canRead = hasPermission('customers:read')
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const dir = useMemo(() => readDir(new URLSearchParams(sp.toString())), [sp])
  const [searchRaw, setSearchRaw] = useState(dir.search)
  const [debounced, setDebounced] = useState(dir.search)

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(searchRaw.trim()), 250)
    return () => window.clearTimeout(id)
  }, [searchRaw])

  const writeDir = useCallback(
    (next: Partial<DirState>, resetPage = true) => {
      const merged: DirState = { ...dir, ...next }
      if (resetPage && !('page' in next)) merged.page = 1
      const params = new URLSearchParams()
      if (merged.page > 1) params.set('page', String(merged.page))
      if (merged.search) params.set('search', merged.search)
      if (merged.region) params.set('region', merged.region)
      if (merged.status) params.set('status', merged.status)
      if (merged.channel) params.set('channel', merged.channel)
      if (merged.type) params.set('type', merged.type)
      if (merged.inactiveDays) params.set('inactiveDays', String(merged.inactiveDays))
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [dir, pathname, router],
  )

  // debounced search → URL
  useEffect(() => {
    if (debounced !== dir.search) writeDir({ search: debounced })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const { data: regionData } = useResource(
    () => (canRead ? client.listCustomerRegions() : Promise.resolve({ data: [] })),
    [canRead],
  )

  const setPage = (p: number) => writeDir({ page: p }, false)

  const { data, error, loading, reload } = useResource(
    () =>
      canRead
        ? client.listCustomers({
            page: dir.page,
            pageSize: DEFAULT_PAGE_SIZE,
            search: dir.search || undefined,
            region: dir.region || undefined,
            status: dir.status || undefined,
            channel: dir.channel || undefined,
            type: dir.type || undefined,
            inactiveDays: dir.inactiveDays || undefined,
          })
        : Promise.resolve(null),
    [dir.page, dir.search, dir.region, dir.status, dir.channel, dir.type, dir.inactiveDays, canRead],
  )

  if (!canRead) {
    return (
      <AdminPage>
        <PageHeader title={t('customers.title')} description={t('customers.description')} />
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

  const rows = data?.data ?? []

  return (
    <AdminPage>
      <PageHeader title={t('customers.title')} description={t('customers.description')} />

      <section className="lh-admin-section">
        <Toolbar>
          <SearchField
            value={searchRaw}
            onChange={setSearchRaw}
            placeholder={t('customers.searchPlaceholder')}
          />
          <LabeledSelect
            label={t('customers.filterRegion')}
            value={dir.region}
            onChange={(value) => writeDir({ region: value })}
          >
            <option value="">{t('customers.filterAll')}</option>
            {(regionData?.data ?? []).map((region) => {
              const value =
                (locale === 'ar' ? (region.cityAr ?? region.cityEn) : (region.cityEn ?? region.cityAr)) ?? ''
              const label = value
              return (
                <option key={`${region.cityAr ?? ''}-${region.cityEn ?? ''}`} value={value}>
                  {label}
                </option>
              )
            })}
          </LabeledSelect>
          <LabeledSelect
            label={t('customers.filterStatus')}
            value={dir.status}
            onChange={(v) => writeDir({ status: v as EntityStatus | '' })}
          >
            <option value="">{t('customers.filterAll')}</option>
            <option value="active">{t('customers.statusActive')}</option>
            <option value="inactive">{t('customers.statusInactive')}</option>
          </LabeledSelect>
          <LabeledSelect
            label={t('customers.filterChannel')}
            value={dir.channel}
            onChange={(v) => writeDir({ channel: v as Channel | '' })}
          >
            <option value="">{t('customers.channelAll')}</option>
            <option value="online">{t('customers.channelOnline')}</option>
            <option value="store">{t('customers.channelStore')}</option>
            <option value="both">{t('customers.channelBoth')}</option>
          </LabeledSelect>
          <LabeledSelect
            label={t('customers.filterType')}
            value={dir.type}
            onChange={(v) => writeDir({ type: v as CustType | '' })}
          >
            <option value="">{t('customers.typeAll')}</option>
            <option value="new">{t('customers.typeNew')}</option>
            <option value="returning">{t('customers.typeReturning')}</option>
            <option value="no_purchase">{t('customers.typeNoPurchase')}</option>
          </LabeledSelect>
          <LabeledSelect
            label={t('customers.filterInactive')}
            value={dir.inactiveDays === '' ? '' : String(dir.inactiveDays)}
            onChange={(v) => writeDir({ inactiveDays: v === '' ? '' : Number(v) })}
          >
            <option value="">{t('customers.inactiveAll')}</option>
            {INACTIVE_DAYS.map((n) => (
              <option key={n} value={n}>
                {t('customers.inactiveDays', { n })}
              </option>
            ))}
          </LabeledSelect>
        </Toolbar>

        {data ? (
          <p className="mb-3 mt-1 text-xs font-semibold text-ink-3">
            {t('common.resultsOf', { count: data.meta.total })}
          </p>
        ) : null}

        {loading && !data ? (
          <Panel flush>
            <RowSkeleton rows={6} />
          </Panel>
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <Panel>
            <AdminEmpty
              icon={<Contact size={22} aria-hidden="true" />}
              title={t('customers.empty')}
            />
          </Panel>
        ) : (
          <>
            {/* Mobile cards */}
            <ul className="flex flex-col gap-2 md:hidden">
              {rows.map((c) => {
                const name =
                  (locale === 'ar' ? c.nameAr : c.nameEn) ??
                  c.nameAr ??
                  c.nameEn ??
                  t('customers.noName')
                const city = (locale === 'ar' ? c.cityAr : c.cityEn) ?? c.cityAr
                return (
                  <li key={c.id}>
                    <Link
                      href={`/admin/customers/${c.id}`}
                      className="lh-admin-record w-full text-start"
                    >
                      <span className="lh-admin-record-body">
                        <span className="lh-admin-record-title flex items-center gap-2">
                          {name}
                          <StatusBadge value={c.status} />
                        </span>
                        <span className="lh-admin-record-meta">
                          <span dir="ltr">{formatPhone(c.phoneNormalized)}</span>
                          {city ? (
                            <>
                              <span>·</span>
                              <span>{city}</span>
                            </>
                          ) : null}
                          {c.lastSeenAt ? (
                            <>
                              <span>·</span>
                              <span>{formatRelative(c.lastSeenAt, locale)}</span>
                            </>
                          ) : null}
                        </span>
                      </span>
                      <ChevronLeft
                        size={15}
                        className="text-ink-4 shrink-0 rtl:rotate-180"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                )
              })}
            </ul>

            {/* Desktop table */}
            <Panel flush className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="lh-admin-table">
                  <thead>
                    <tr>
                      <th>{t('customers.colName')}</th>
                      <th>{t('customers.colPhone')}</th>
                      <th>{t('customers.colCity')}</th>
                      <th>{t('customers.colStatus')}</th>
                      <th>{t('customers.colLastSeen')}</th>
                      <th aria-label={t('common.actions')} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => {
                      const name =
                        (locale === 'ar' ? c.nameAr : c.nameEn) ??
                        c.nameAr ??
                        c.nameEn ??
                        t('customers.noName')
                      const city = (locale === 'ar' ? c.cityAr : c.cityEn) ?? c.cityAr
                      return (
                        <tr key={c.id}>
                          <td className="font-medium text-ink">{name}</td>
                          <td dir="ltr" className="text-ink-2">
                            {formatPhone(c.phoneNormalized)}
                          </td>
                          <td className="text-ink-2">{city ?? '—'}</td>
                          <td>
                            <StatusBadge value={c.status} />
                          </td>
                          <td className="text-ink-3">
                            {c.lastSeenAt ? formatRelative(c.lastSeenAt, locale) : '—'}
                          </td>
                          <td className="text-end">
                            <Link href={`/admin/customers/${c.id}`} className="lh-admin-link">
                              {t('customerCard.viewShort')}
                              <ChevronLeft
                                size={14}
                                className="rtl:rotate-180"
                                aria-hidden="true"
                              />
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            {data ? <Pagination meta={data.meta} onPage={setPage} /> : null}
          </>
        )}
      </section>
    </AdminPage>
  )
}
