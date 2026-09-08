'use client'

import { ChevronLeft, PackageOpen, Plus, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import { Button, Dialog, Select } from '@likehoney/ui'

import {
  client,
  type CategoryDoc,
  type ProductStatus,
  type StockLevel,
  type SupplierDoc,
} from '../../../lib/admin/client'
import { useResource } from '../../../lib/admin/hooks'
import { useAuth } from '../../../lib/admin/auth'
import { useT } from '../../../lib/admin/i18n'
import {
  AdminEmpty,
  AdminPage,
  DEFAULT_PAGE_SIZE,
  ErrorState,
  PageHeader,
  Pagination,
  Panel,
  ReadinessChip,
  RowSkeleton,
  SearchField,
  StatusBadge,
  StockLevelPill,
  Toolbar,
} from '../_components/shared'

function monogram(name: string): string {
  const clean = name.trim()
  if (clean.length === 0) return '·'
  return Array.from(clean).slice(0, 2).join('').toUpperCase()
}

function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

export default function AdminProductsPage() {
  const t = useT()
  const { hasPermission } = useAuth()
  const canInventory = hasPermission('inventory:read')

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatusRaw] = useState<'all' | ProductStatus>('all')
  const [category, setCategoryRaw] = useState('')
  // Honour ?supplier=<id> arriving from the dashboard reorder module.
  const [supplier, setSupplierRaw] = useState<string>(() =>
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('supplier') ?? ''),
  )
  const [stock, setStock] = useState<'all' | StockLevel>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const debouncedSearch = useDebounced(search.trim())

  // Any query-shaping change resets to the first page.
  const setStatus = (value: 'all' | ProductStatus) => {
    setStatusRaw(value)
    setPage(1)
  }
  const setCategory = (value: string) => {
    setCategoryRaw(value)
    setPage(1)
  }
  const setSupplier = (value: string) => {
    setSupplierRaw(value)
    setPage(1)
  }
  const onSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const { data, error, loading, reload } = useResource(
    () =>
      client.listProducts({
        page,
        pageSize: DEFAULT_PAGE_SIZE,
        search: debouncedSearch || undefined,
        status: status === 'all' ? undefined : status,
        categoryId: category || undefined,
        supplierId: supplier || undefined,
      }),
    [page, debouncedSearch, status, category, supplier],
    { revalidate: true },
  )

  const categories = useResource(() => client.listCategories({ pageSize: 100 }), [])
  const suppliers = useResource(() => client.listSuppliers({ pageSize: 100 }), [])
  const summary = useResource(
    () => (canInventory ? client.stockSummary() : Promise.resolve(null)),
    [canInventory],
    { revalidate: true },
  )

  const categoryById = useMemo(
    () => new Map<string, CategoryDoc>((categories.data?.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  )
  const supplierById = useMemo(
    () => new Map<string, SupplierDoc>((suppliers.data?.data ?? []).map((s) => [s.id, s])),
    [suppliers.data],
  )
  // Physical stock per product — real on-hand totals from the server, classified
  // by the shared threshold, independent of lifecycle. A product with no known
  // balance is treated as 0 units ("نافد"), never invented as available.
  const stockByProduct = useMemo(() => {
    const map = new Map<string, StockLevel>()
    for (const [id, level] of Object.entries(summary.data?.productStock ?? {})) {
      map.set(id, level)
    }
    return map
  }, [summary.data])
  const stockLevelOf = (productId: string): StockLevel => stockByProduct.get(productId) ?? 'out'
  const readiness = summary.data?.readiness ?? {}

  const anyFilter =
    debouncedSearch.length > 0 ||
    status !== 'all' ||
    category.length > 0 ||
    supplier.length > 0 ||
    stock !== 'all'

  const clearFilters = () => {
    setSearch('')
    setStatus('all')
    setCategory('')
    setSupplier('')
    setStock('all')
  }

  // Client-side stock refinement (the list endpoint has no stock filter).
  const rows = useMemo(() => {
    const list = data?.data ?? []
    if (stock === 'all') return list
    return list.filter((p) => (stockByProduct.get(p.id) ?? 'out') === stock)
  }, [data, stock, stockByProduct])

  const filterControls = (
    <>
      <Select
        aria-label={t('products.statusFilter')}
        value={status}
        onChange={(e) => setStatus(e.target.value as 'all' | ProductStatus)}
        className="lh-admin-toolbar-field basis-36"
      >
        <option value="all">{t('products.filterAll')}</option>
        <option value="draft">{t('products.filterDraft')}</option>
        <option value="active">{t('common.active')}</option>
        <option value="inactive">{t('common.inactive')}</option>
        <option value="archived">{t('products.filterArchived')}</option>
      </Select>
      <Select
        aria-label={t('products.categoryColumn')}
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="lh-admin-toolbar-field basis-40"
      >
        <option value="">{t('products.categoryAll')}</option>
        {(categories.data?.data ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.nameAr}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t('products.supplierFilter')}
        value={supplier}
        onChange={(e) => setSupplier(e.target.value)}
        className="lh-admin-toolbar-field basis-40"
      >
        <option value="">{t('products.supplierAll')}</option>
        {(suppliers.data?.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.nameAr}
          </option>
        ))}
      </Select>
      {canInventory ? (
        <Select
          aria-label={t('products.stockFilter')}
          value={stock}
          onChange={(e) => setStock(e.target.value as 'all' | StockLevel)}
          className="lh-admin-toolbar-field basis-36"
        >
          <option value="all">{t('products.stockAll')}</option>
          <option value="available">{t('inventory.available')}</option>
          <option value="low">{t('inventory.lowStock')}</option>
          <option value="out">{t('inventory.outOfStock')}</option>
        </Select>
      ) : null}
    </>
  )

  return (
    <AdminPage width="wide">
      <PageHeader
        title={t('products.title')}
        description={t('products.description')}
        actions={
          <Link href="/admin/products/new">
            <Button>
              <Plus size={16} aria-hidden="true" />
              {t('products.new')}
            </Button>
          </Link>
        }
      />

      <Toolbar collapsible>
        <SearchField
          value={search}
          onChange={onSearch}
          placeholder={t('products.searchPlaceholder')}
        />
        {filterControls}
        <Button
          variant="secondary"
          size="sm"
          className="lh-admin-filter-trigger"
          onClick={() => setFiltersOpen(true)}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          {t('products.filters')}
        </Button>
        {data && !loading ? (
          <span className="lh-admin-toolbar-count">
            {t('products.resultCount', { count: data.meta.total })}
          </span>
        ) : null}
      </Toolbar>

      {filtersOpen ? (
        <Dialog
          open
          onClose={() => setFiltersOpen(false)}
          title={t('products.filters')}
          closeLabel={t('common.close')}
        >
          <div className="flex flex-col gap-3">
            {filterControls}
            <div className="flex justify-between gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                {t('common.clear')}
              </Button>
              <Button size="sm" onClick={() => setFiltersOpen(false)}>
                {t('common.done')}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {loading && !data ? (
        <Panel flush>
          <RowSkeleton rows={6} />
        </Panel>
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data || data.meta.total === 0 ? (
        <Panel>
          <AdminEmpty
            icon={<PackageOpen size={22} aria-hidden="true" />}
            title={anyFilter ? t('products.zeroResult') : t('products.empty')}
            text={anyFilter ? t('products.zeroResultHint') : t('products.emptyHint')}
            action={
              anyFilter ? (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  {t('products.clearFilters')}
                </Button>
              ) : (
                <Link href="/admin/products/new">
                  <Button size="sm">
                    <Plus size={15} aria-hidden="true" />
                    {t('products.new')}
                  </Button>
                </Link>
              )
            }
          />
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <AdminEmpty
            icon={<PackageOpen size={22} aria-hidden="true" />}
            title={t('products.zeroResult')}
            text={t('products.zeroResultHint')}
            action={
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                {t('products.clearFilters')}
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          {/* Mobile: record cards */}
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((product) => {
              const level = canInventory ? stockLevelOf(product.id) : undefined
              return (
                <li key={product.id}>
                  <Link href={`/admin/products/${product.id}`} className="lh-admin-record">
                    <span className="lh-admin-thumb" aria-hidden="true">
                      {monogram(product.nameAr)}
                    </span>
                    <span className="lh-admin-record-body">
                      <span className="lh-admin-record-title">{product.nameAr}</span>
                      <span className="lh-admin-record-meta">
                        <StatusBadge value={product.status} />
                        {level ? <StockLevelPill level={level} /> : null}
                        {readiness[product.id] ? (
                          <ReadinessChip value={readiness[product.id]!} />
                        ) : null}
                        {product.categoryId && categoryById.get(product.categoryId) ? (
                          <span>{categoryById.get(product.categoryId)!.nameAr}</span>
                        ) : null}
                      </span>
                    </span>
                    <ChevronLeft
                      size={16}
                      className="shrink-0 text-ink-4 rtl:rotate-180"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              )
            })}
          </ul>

          {/* Desktop: data table */}
          <Panel flush className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="lh-admin-table">
                <thead>
                  <tr>
                    <th>{t('products.nameColumn')}</th>
                    <th>{t('products.categoryColumn')}</th>
                    <th>{t('products.supplierColumn')}</th>
                    {canInventory ? <th>{t('products.stockColumn')}</th> : null}
                    {canInventory ? <th>{t('products.readinessColumn')}</th> : null}
                    <th>{t('products.statusColumn')}</th>
                    <th aria-label={t('common.actions')} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((product) => {
                    const cat = product.categoryId
                      ? categoryById.get(product.categoryId)
                      : undefined
                    const sup = product.supplierId
                      ? supplierById.get(product.supplierId)
                      : undefined
                    const level = stockLevelOf(product.id)
                    return (
                      <tr key={product.id}>
                        <td>
                          <div className="lh-admin-cell-lead">
                            <span className="lh-admin-thumb" aria-hidden="true">
                              {monogram(product.nameAr)}
                            </span>
                            <div className="min-w-0">
                              <div className="lh-admin-cell-title">{product.nameAr}</div>
                              <div className="lh-admin-cell-sub">{product.nameEn}</div>
                            </div>
                          </div>
                        </td>
                        <td className="text-ink-2">
                          {cat ? (
                            cat.nameAr
                          ) : (
                            <span className="text-ink-4">{t('products.unassigned')}</span>
                          )}
                        </td>
                        <td className="text-ink-2">
                          {sup ? (
                            sup.nameAr
                          ) : (
                            <span className="text-ink-4">{t('products.form.supplierNone')}</span>
                          )}
                        </td>
                        {canInventory ? (
                          <td>
                            <StockLevelPill level={level} />
                          </td>
                        ) : null}
                        {canInventory ? (
                          <td>
                            {readiness[product.id] ? (
                              <ReadinessChip value={readiness[product.id]!} />
                            ) : (
                              <span className="text-ink-4">—</span>
                            )}
                          </td>
                        ) : null}
                        <td>
                          <StatusBadge value={product.status} />
                        </td>
                        <td className="text-end">
                          <Link href={`/admin/products/${product.id}`} className="lh-admin-link">
                            {t('products.openProduct')}
                            <ChevronLeft size={14} className="rtl:rotate-180" aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Pagination meta={data.meta} pending={loading} onPage={setPage} />
        </>
      )}
    </AdminPage>
  )
}
