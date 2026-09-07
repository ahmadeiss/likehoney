'use client'

import {
  ArrowRight,
  Boxes,
  CircleAlert,
  KeyRound,
  Package,
  PackagePlus,
  PackageSearch,
  Plus,
  Receipt,
  RefreshCw,
  ScanLine,
  Tags,
  Truck,
  Warehouse,
} from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'

import { Button } from '@likehoney/ui'

import {
  ApiError,
  client,
  type InventoryAttentionItem,
  type InventorySummaryDoc,
  type MovementDoc,
  type Paged,
} from '../../lib/admin/client'
import { useResource } from '../../lib/admin/hooks'
import { useAuth } from '../../lib/admin/auth'
import { useIdentity } from '../../lib/admin/identity'
import { useLocale, useT } from '../../lib/admin/i18n'
import { useAdminRole } from '../../lib/admin/role'
import { movementEventLabel } from '../../lib/admin/movements'
import { formatCount, formatDate, formatRelative } from '../../lib/admin/format'
import {
  AdminEmpty,
  AdminPage,
  MoreLink,
  Panel,
  SectionHead,
  Stat,
  StatStrip,
  StockLevelPill,
  StripSkeleton,
  RowSkeleton,
} from './_components/shared'

function greetingKey(
  hour: number,
): 'dashboard.greetingMorning' | 'dashboard.greetingAfternoon' | 'dashboard.greetingEvening' {
  if (hour < 12) return 'dashboard.greetingMorning'
  if (hour < 18) return 'dashboard.greetingAfternoon'
  return 'dashboard.greetingEvening'
}

// ---------------------------------------------------------------------------
// Shared data hook
// ---------------------------------------------------------------------------

function useDashboardData() {
  const { hasPermission } = useAuth()
  const { staffId, hasIdentity, identityReady } = useIdentity()

  const canCatalog = hasPermission('catalog:read')
  const canInventory = hasPermission('inventory:read')
  const blocked = !identityReady || !hasIdentity
  const emptyPage = <T,>(): Paged<T> => ({ data: [], meta: { page: 0, pageSize: 0, total: 0 } })

  const summary = useResource<InventorySummaryDoc | null>(
    () => (blocked || !canInventory ? Promise.resolve(null) : client.stockSummary()),
    [identityReady, hasIdentity, staffId, canInventory],
    { revalidate: true },
  )

  const products = useResource(
    () =>
      blocked || !canCatalog ? Promise.resolve(emptyPage()) : client.listProducts({ pageSize: 1 }),
    [identityReady, hasIdentity, staffId, canCatalog],
    { revalidate: true },
  )
  const categories = useResource(
    () =>
      blocked || !canCatalog
        ? Promise.resolve(emptyPage())
        : client.listCategories({ pageSize: 1 }),
    [identityReady, hasIdentity, staffId, canCatalog],
  )
  const suppliers = useResource(
    () =>
      blocked || !canCatalog ? Promise.resolve(emptyPage()) : client.listSuppliers({ pageSize: 1 }),
    [identityReady, hasIdentity, staffId, canCatalog],
  )

  const movements = useResource<Paged<MovementDoc>>(
    async () => {
      if (blocked || !canInventory) return emptyPage()
      const page = await client.listMovements({ pageSize: 6 })
      const skus = await Promise.all(
        page.data.map((m) =>
          client.getVariant(m.variantId).then(
            (v) => [m.variantId, v.sku] as const,
            () => [m.variantId, m.variantId.slice(0, 8)] as const,
          ),
        ),
      )
      const byId = new Map(skus)
      return {
        meta: page.meta,
        data: page.data.map((m) => ({ ...m, sku: byId.get(m.variantId) })),
      }
    },
    [identityReady, hasIdentity, staffId, canInventory],
    { revalidate: true },
  )

  const resources = [summary, products, categories, suppliers, movements]
  return {
    canCatalog,
    canInventory,
    hasIdentity,
    summary,
    products,
    categories,
    suppliers,
    movements,
    loading: resources.some((r) => r.loading) && !resources.some((r) => r.error),
    failed: resources.some((r) => r.error !== null),
    unauthorized: resources.some(
      (r) =>
        r.error instanceof ApiError && (r.error.code === 'unauthorized' || r.error.status === 401),
    ),
    forbidden: resources.some((r) => r.error instanceof ApiError && r.error.code === 'forbidden'),
    reloadAll: () => resources.forEach((r) => r.reload()),
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminDashboardPage() {
  const t = useT()
  const role = useAdminRole()
  const data = useDashboardData()

  if (!data.hasIdentity) {
    return (
      <AdminPage width="dash">
        <Panel>
          <AdminEmpty
            icon={<KeyRound size={22} aria-hidden="true" />}
            title={t('dashboard.noIdentityTitle')}
            text={t('dashboard.noIdentityHint')}
            action={
              <Link href="/admin/staff">
                <Button variant="secondary" size="sm">
                  {t('dashboard.pickIdentity')}
                </Button>
              </Link>
            }
          />
        </Panel>
      </AdminPage>
    )
  }

  if (data.failed) {
    const denied = data.unauthorized || data.forbidden
    const title = denied
      ? data.unauthorized
        ? t('dashboard.invalidIdentityTitle')
        : t('dashboard.forbiddenTitle')
      : t('dashboard.errorTitle')
    const hint = denied
      ? data.unauthorized
        ? t('dashboard.invalidIdentityHint')
        : t('dashboard.forbiddenHint')
      : t('dashboard.errorHint')
    return (
      <AdminPage width="dash">
        <Panel>
          <AdminEmpty
            icon={<CircleAlert size={22} aria-hidden="true" />}
            title={title}
            text={hint}
            action={
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={data.reloadAll}>
                  <RefreshCw size={14} aria-hidden="true" />
                  {t('common.retry')}
                </Button>
                {denied ? (
                  <Link href="/admin/staff">
                    <Button variant="secondary" size="sm">
                      {t('dashboard.pickIdentity')}
                    </Button>
                  </Link>
                ) : null}
              </div>
            }
          />
        </Panel>
      </AdminPage>
    )
  }

  return role === 'owner' ? <OwnerDashboard data={data} /> : <EmployeeHome data={data} />
}

type DashData = ReturnType<typeof useDashboardData>

// ---------------------------------------------------------------------------
// Owner dashboard — decision surface
// ---------------------------------------------------------------------------

function OwnerDashboard({ data }: { data: DashData }) {
  const t = useT()
  const locale = useLocale()
  const { me } = useAuth()
  const greeting = useMemo(() => greetingKey(new Date().getHours()), [])
  const today = useMemo(
    () => formatDate(new Date(), locale).split('،')[0] ?? formatDate(new Date(), locale),
    [locale],
  )

  const s = data.summary.data
  const attention = s?.attention ?? []
  const shortages = s?.supplierShortages ?? []
  const recent = data.movements.data?.data ?? []
  const outCount = s?.stockHealth.out ?? 0
  const lowCount = s?.stockHealth.low ?? 0

  return (
    <AdminPage width="dash">
      <header className="lh-admin-greeting">
        <div>
          <span className="lh-admin-greeting-date">{today}</span>
          <h1>
            {t(greeting)}
            {me?.staff.nameAr ? `، ${me.staff.nameAr}` : ''}
          </h1>
          <p>{t('dashboard.greetingMoreOwner')}</p>
        </div>
        {data.canCatalog ? (
          <Link href="/admin/products/new">
            <Button>
              <PackagePlus size={16} aria-hidden="true" />
              {t('products.new')}
            </Button>
          </Link>
        ) : null}
      </header>

      {data.loading && !s ? (
        <StripSkeleton tiles={5} />
      ) : (
        <StatStrip>
          <Stat
            label={t('dashboard.attentionTitle')}
            value={formatCount(outCount + lowCount, locale)}
            note={t('dashboard.attentionSummary', { out: outCount, low: lowCount })}
            tone={outCount + lowCount > 0 ? 'accent' : undefined}
          />
          {data.canInventory ? (
            <>
              <Stat
                label={t('inventory.summaryAvailable')}
                value={formatCount(s?.stockHealth.available ?? 0, locale)}
                tone="success"
                href="/admin/inventory"
              />
              <Stat
                label={t('inventory.summaryLow')}
                value={formatCount(lowCount, locale)}
                tone="warning"
                href="/admin/inventory"
              />
              <Stat
                label={t('inventory.summaryOut')}
                value={formatCount(outCount, locale)}
                tone="danger"
                href="/admin/inventory"
              />
            </>
          ) : null}
          {data.canCatalog ? (
            <Stat
              label={t('dashboard.productsTotal')}
              value={formatCount(data.products.data?.meta.total ?? 0, locale)}
              href="/admin/products"
            />
          ) : null}
          {data.canCatalog ? (
            <Stat
              label={t('dashboard.suppliersTotal')}
              value={formatCount(data.suppliers.data?.meta.total ?? 0, locale)}
              href="/admin/suppliers"
            />
          ) : null}
        </StatStrip>
      )}

      {/* Needs attention — primary module */}
      <section className="lh-admin-section">
        <SectionHead
          title={t('dashboard.attentionTitle')}
          sub={t('inventory.healthHint')}
          action={
            data.canInventory ? (
              <MoreLink href="/admin/inventory">{t('dashboard.attentionViewInventory')}</MoreLink>
            ) : undefined
          }
        />
        <Panel flush>
          {data.loading && !s ? (
            <RowSkeleton rows={4} />
          ) : attention.length === 0 ? (
            <AdminEmpty
              icon={<Boxes size={22} aria-hidden="true" />}
              title={t('dashboard.attentionEmpty')}
            />
          ) : (
            <ul className="lh-admin-list">
              {attention.map((item) => (
                <AttentionRow key={item.variantId} item={item} />
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Reorder by supplier */}
        <section className="lh-admin-section">
          <SectionHead title={t('dashboard.reorderTitle')} sub={t('dashboard.reorderHint')} />
          <Panel flush>
            {data.loading && !s ? (
              <RowSkeleton rows={3} />
            ) : shortages.length === 0 ? (
              <AdminEmpty
                icon={<Truck size={22} aria-hidden="true" />}
                title={t('dashboard.reorderEmpty')}
              />
            ) : (
              <div>
                {shortages.map((sup) => {
                  const items = attention.filter((a) => a.supplierId === sup.supplierId).slice(0, 4)
                  return (
                    <div key={sup.supplierId} className="lh-admin-group">
                      <div className="lh-admin-group-head">
                        <span className="lh-admin-group-name">{sup.supplierNameAr}</span>
                        <span className="lh-admin-group-count">
                          {t('suppliers.productCount')}: {formatCount(sup.productCount, locale)} ·{' '}
                          <span className="text-warning">
                            {formatCount(sup.lowVariants, locale)} {t('suppliers.lowWord')}
                          </span>{' '}
                          ·{' '}
                          <span className="text-danger">
                            {formatCount(sup.outVariants, locale)} {t('suppliers.outWord')}
                          </span>
                        </span>
                      </div>
                      <ul className="lh-admin-list">
                        {items.map((a) => (
                          <li key={a.variantId} className="lh-admin-list-row">
                            <span
                              className={`lh-admin-list-glyph lh-admin-list-glyph--${a.level === 'out' ? 'danger' : 'warning'}`}
                              aria-hidden="true"
                            >
                              <CircleAlert size={15} />
                            </span>
                            <div className="lh-admin-list-body">
                              <span className="lh-admin-list-title">{a.productNameAr}</span>
                              <span className="lh-admin-list-meta">
                                {a.level === 'out'
                                  ? t('dashboard.outNowShort')
                                  : t('dashboard.remaining', {
                                      n: formatCount(a.quantityOnHand, locale),
                                    })}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <div className="px-5 py-3">
                        <Link
                          href={`/admin/products?supplier=${sup.supplierId}`}
                          className="lh-admin-link"
                        >
                          {t('dashboard.viewSupplierProducts')}
                          <ArrowRight size={14} aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </section>

        {/* Recent activity */}
        <section className="lh-admin-section">
          <SectionHead
            title={t('dashboard.recentMovements')}
            sub={t('dashboard.recentMovementsHint')}
            action={
              data.canInventory ? (
                <MoreLink href="/admin/inventory">{t('dashboard.viewAll')}</MoreLink>
              ) : undefined
            }
          />
          <Panel flush>
            {data.loading && !data.movements.data ? (
              <RowSkeleton rows={4} />
            ) : recent.length === 0 ? (
              <AdminEmpty
                icon={<Warehouse size={22} aria-hidden="true" />}
                title={t('inventory.empty')}
              />
            ) : (
              <ul className="lh-admin-activity">
                {recent.map((m) => (
                  <li key={m.id} className="lh-admin-activity-item">
                    <span
                      className={`lh-admin-activity-dot${m.quantityChange > 0 ? ' lh-admin-activity-dot--in' : ' lh-admin-activity-dot--out'}`}
                      aria-hidden="true"
                    />
                    <div>
                      <p className="lh-admin-activity-text">{movementEventLabel(m, t)}</p>
                      <p className="lh-admin-activity-meta">
                        {m.sku ? `${m.sku} · ` : ''}
                        {formatRelative(m.createdAt, locale)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
      </div>

      {/* Catalog shortcuts */}
      {data.canCatalog ? (
        <section className="lh-admin-section">
          <SectionHead title={t('dashboard.catalogSnapshot')} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link href="/admin/products" className="lh-admin-quick">
              <span className="lh-admin-quick-icon">
                <Package size={18} aria-hidden="true" />
              </span>
              <span>
                <span className="lh-admin-quick-title">{t('dashboard.productsCta')}</span>
                <span className="lh-admin-quick-sub">
                  {formatCount(data.products.data?.meta.total ?? 0, locale)}{' '}
                  {t('dashboard.productsTotal')}
                </span>
              </span>
            </Link>
            <Link href="/admin/categories" className="lh-admin-quick">
              <span className="lh-admin-quick-icon">
                <Tags size={18} aria-hidden="true" />
              </span>
              <span>
                <span className="lh-admin-quick-title">{t('shell.nav.categories')}</span>
                <span className="lh-admin-quick-sub">
                  {formatCount(data.categories.data?.meta.total ?? 0, locale)}{' '}
                  {t('dashboard.categoriesTotal')}
                </span>
              </span>
            </Link>
            <Link href="/admin/suppliers" className="lh-admin-quick">
              <span className="lh-admin-quick-icon">
                <Truck size={18} aria-hidden="true" />
              </span>
              <span>
                <span className="lh-admin-quick-title">{t('shell.nav.suppliers')}</span>
                <span className="lh-admin-quick-sub">
                  {formatCount(data.suppliers.data?.meta.total ?? 0, locale)}{' '}
                  {t('dashboard.suppliersTotal')}
                </span>
              </span>
            </Link>
          </div>
        </section>
      ) : null}
    </AdminPage>
  )
}

function AttentionRow({ item }: { item: InventoryAttentionItem }) {
  const locale = useLocale()
  return (
    <li className="lh-admin-list-row">
      <span
        className={`lh-admin-list-glyph lh-admin-list-glyph--${item.level === 'out' ? 'danger' : 'warning'}`}
        aria-hidden="true"
      >
        <CircleAlert size={15} />
      </span>
      <div className="lh-admin-list-body">
        <span className="lh-admin-list-title">{item.productNameAr}</span>
        <span className="lh-admin-list-meta">{item.sku}</span>
      </div>
      <div className="lh-admin-list-trail">
        <span className="lh-admin-list-num">{formatCount(item.quantityOnHand, locale)}</span>
        <StockLevelPill level={item.level} />
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Employee home — action surface
// ---------------------------------------------------------------------------

function EmployeeHome({ data }: { data: DashData }) {
  const t = useT()
  const locale = useLocale()
  const { me, hasPermission } = useAuth()

  const s = data.summary.data
  const attention = s?.attention ?? []
  const attentionCount = (s?.stockHealth.out ?? 0) + (s?.stockHealth.low ?? 0)
  const recent = data.movements.data?.data ?? []
  const canWrite = hasPermission('catalog:write')
  const canSell = hasPermission('store-sales:write')

  return (
    <AdminPage width="dash">
      <header className="lh-admin-greeting">
        <div>
          <span className="lh-admin-greeting-date">
            {me?.staff.nameAr ? t('home.hi', { name: me.staff.nameAr }) : ''}
          </span>
          <h1>{t('home.employeeTitle')}</h1>
        </div>
      </header>

      {/* Primary actions — large touch targets */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {canSell ? (
          <Link href="/admin/store-sales" className="lh-admin-quick lh-admin-quick--primary">
            <span className="lh-admin-quick-icon">
              <Receipt size={20} aria-hidden="true" />
            </span>
            <span>
              <span className="lh-admin-quick-title">{t('home.sellInStore')}</span>
              <span className="lh-admin-quick-sub">{t('home.sellInStoreSub')}</span>
            </span>
          </Link>
        ) : null}

        {data.canCatalog ? (
          <Link href="/admin/products" className="lh-admin-quick">
            <span className="lh-admin-quick-icon">
              <PackageSearch size={20} aria-hidden="true" />
            </span>
            <span>
              <span className="lh-admin-quick-title">{t('home.findProduct')}</span>
              <span className="lh-admin-quick-sub">{t('home.findProductSub')}</span>
            </span>
          </Link>
        ) : null}

        {canWrite ? (
          <Link href="/admin/products/new" className="lh-admin-quick">
            <span className="lh-admin-quick-icon">
              <Plus size={20} aria-hidden="true" />
            </span>
            <span>
              <span className="lh-admin-quick-title">{t('home.addProduct')}</span>
              <span className="lh-admin-quick-sub">{t('home.addProductSub')}</span>
            </span>
          </Link>
        ) : null}

        {data.canInventory ? (
          <Link href="/admin/inventory" className="lh-admin-quick">
            <span className="lh-admin-quick-icon">
              <Warehouse size={20} aria-hidden="true" />
            </span>
            <span>
              <span className="lh-admin-quick-title">{t('home.adjustStock')}</span>
              <span className="lh-admin-quick-sub">{t('home.adjustStockSub')}</span>
            </span>
          </Link>
        ) : null}

        {data.canInventory ? (
          <Link href="/admin/inventory" className="lh-admin-quick">
            <span className="lh-admin-quick-icon">
              <ScanLine size={20} aria-hidden="true" />
            </span>
            <span>
              <span className="lh-admin-quick-title">{t('home.checkStock')}</span>
              <span className="lh-admin-quick-sub">{t('home.checkStockSub')}</span>
            </span>
          </Link>
        ) : null}
      </div>

      {/* Needs attention */}
      {data.canInventory ? (
        <section className="lh-admin-section">
          <SectionHead
            title={t('home.needsAttention')}
            sub={t('home.needsAttentionSub')}
            action={<MoreLink href="/admin/inventory">{t('common.viewAll')}</MoreLink>}
          />
          <Panel flush>
            {data.loading && !s ? (
              <RowSkeleton rows={3} />
            ) : attention.length === 0 ? (
              <AdminEmpty
                icon={<Boxes size={22} aria-hidden="true" />}
                title={t('home.allClear')}
              />
            ) : (
              <ul className="lh-admin-list">
                {attention.slice(0, 6).map((item) => (
                  <AttentionRow key={item.variantId} item={item} />
                ))}
              </ul>
            )}
          </Panel>
        </section>
      ) : null}

      {/* Recent activity */}
      {data.canInventory ? (
        <section className="lh-admin-section">
          <SectionHead title={t('home.recentActivity')} />
          <Panel flush>
            {data.loading && !data.movements.data ? (
              <RowSkeleton rows={4} />
            ) : recent.length === 0 ? (
              <AdminEmpty
                icon={<Warehouse size={22} aria-hidden="true" />}
                title={t('inventory.empty')}
              />
            ) : (
              <ul className="lh-admin-activity">
                {recent.map((m) => (
                  <li key={m.id} className="lh-admin-activity-item">
                    <span
                      className={`lh-admin-activity-dot${m.quantityChange > 0 ? ' lh-admin-activity-dot--in' : ' lh-admin-activity-dot--out'}`}
                      aria-hidden="true"
                    />
                    <div>
                      <p className="lh-admin-activity-text">{movementEventLabel(m, t)}</p>
                      <p className="lh-admin-activity-meta">
                        {m.sku ? `${m.sku} · ` : ''}
                        {formatRelative(m.createdAt, locale)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
      ) : null}

      <p className="text-center text-xs text-ink-3">
        <span className="tabular-nums">{formatCount(attentionCount, locale)}</span>{' '}
        {t('home.needsAttention')}
      </p>
    </AdminPage>
  )
}
