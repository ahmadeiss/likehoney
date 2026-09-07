'use client'

import { Minus, PackageOpen, Plus, Warehouse } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button, Select } from '@likehoney/ui'
import {
  INVENTORY_MOVEMENT_TYPE_LABELS,
  deriveSellability,
  localizedLabel,
  type InventoryMovementType,
  type Sellability,
} from '@likehoney/shared'

import {
  ApiError,
  client,
  type InventorySummaryDoc,
  type ProductStatus,
  type StockLevel,
  type VariantStatus,
} from '../../../lib/admin/client'
import { useResource } from '../../../lib/admin/hooks'
import { useAuth } from '../../../lib/admin/auth'
import { useLocale, useT } from '../../../lib/admin/i18n'
import { formatCount, formatRelative } from '../../../lib/admin/format'
import { movementEventLabel } from '../../../lib/admin/movements'
import {
  AdminEmpty,
  AdminPage,
  ErrorState,
  PageHeader,
  Pagination,
  Panel,
  ReservedStockReadout,
  RowSkeleton,
  SearchField,
  SectionHead,
  SellabilityChip,
  Stat,
  StatStrip,
  StockLevelPill,
  StripSkeleton,
  Toolbar,
} from '../_components/shared'
import {
  StockMovementDialog,
  type MovementMode,
  type StockVariantOption,
} from '../_components/stock-movement-dialog'

const INVENTORY_PAGE_SIZE = 15

interface BalanceRow {
  variantId: string
  sku: string
  productName: string
  productId: string
  productStatus: ProductStatus
  status: VariantStatus
  quantityOnHand: number
  quantityReserved: number
  level: StockLevel
  sellability: Sellability
}

const MOVEMENT_TYPE_ORDER = Object.keys(INVENTORY_MOVEMENT_TYPE_LABELS) as InventoryMovementType[]

function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

export default function AdminInventoryPage() {
  const t = useT()
  const locale = useLocale()
  const { hasPermission } = useAuth()
  const canInventory = hasPermission('inventory:read')

  const [dialog, setDialog] = useState<{ variantId?: string; mode: MovementMode } | null>(null)
  const [query, setQuery] = useState('')
  const [level, setLevelRaw] = useState<'all' | StockLevel>('all')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounced(query.trim())

  // Stock-level filter and search both re-shape the query — always back to page 1.
  const onSearch = (value: string) => {
    setQuery(value)
    setPage(1)
  }
  const toggleLevel = (next: StockLevel) => {
    setLevelRaw((current) => (current === next ? 'all' : next))
    setPage(1)
  }
  const resetLevel = () => {
    setLevelRaw('all')
    setPage(1)
  }

  const summary = useResource<InventorySummaryDoc | null>(
    () => (canInventory ? client.stockSummary() : Promise.resolve(null)),
    [canInventory],
    { revalidate: true },
  )

  // The paginated, filtered, searched register — server-side. Only this list
  // (never the summary counters) reflects the current filter/search/page.
  const register = useResource(
    () =>
      canInventory
        ? client.listInventoryBalances({
            page,
            pageSize: INVENTORY_PAGE_SIZE,
            search: debouncedSearch || undefined,
            level: level === 'all' ? undefined : level,
          })
        : Promise.resolve(null),
    [canInventory, page, debouncedSearch, level],
    { revalidate: true },
  )

  // A separate, small, unfiltered fetch feeding the "adjust quantity" dialog's
  // full variant picker — independent of the paginated register above so
  // opening the dialog isn't gated by whatever filter/page is on screen.
  const picker = useResource(
    () =>
      canInventory
        ? client.listInventoryBalances({ page: 1, pageSize: 100 })
        : Promise.resolve(null),
    [canInventory],
    { revalidate: true },
  )

  const toRow = (item: {
    variantId: string
    sku: string
    productId: string
    productNameAr: string
    productNameEn: string
    productStatus: ProductStatus
    variantStatus: VariantStatus
    quantityOnHand: number
    quantityReserved: number
    level: StockLevel
  }): BalanceRow => ({
    variantId: item.variantId,
    sku: item.sku,
    productName: locale === 'ar' ? item.productNameAr : item.productNameEn,
    productId: item.productId,
    productStatus: item.productStatus,
    status: item.variantStatus,
    quantityOnHand: item.quantityOnHand,
    quantityReserved: item.quantityReserved,
    level: item.level,
    sellability: deriveSellability({
      productStatus: item.productStatus,
      variantStatus: item.variantStatus,
      quantityOnHand: item.quantityOnHand,
    }),
  })

  const rows = useMemo<BalanceRow[] | null>(
    () => (register.data ? register.data.data.map(toRow) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [register.data, locale],
  )

  const catalogDenied = register.error instanceof ApiError && register.error.code === 'forbidden'

  const health = summary.data?.stockHealth
  const variantOptions: StockVariantOption[] = (picker.data?.data ?? []).map((item) => ({
    variantId: item.variantId,
    sku: item.sku,
    label: locale === 'ar' ? item.productNameAr : item.productNameEn,
    quantityOnHand: item.quantityOnHand,
  }))

  const emptyTitle =
    level === 'available'
      ? t('inventory.emptyAvailable')
      : level === 'low'
        ? t('inventory.emptyLow')
        : level === 'out'
          ? t('inventory.emptyOut')
          : debouncedSearch.length > 0
            ? t('products.zeroResult')
            : t('inventory.empty')

  return (
    <AdminPage width="wide">
      <PageHeader
        title={t('inventory.title')}
        description={t('inventory.description')}
        actions={
          <Button onClick={() => setDialog({ mode: 'add' })} disabled={catalogDenied}>
            <Plus size={16} aria-hidden="true" />
            {t('inventory.newMovement')}
          </Button>
        }
      />

      {dialog ? (
        <StockMovementDialog
          variantOptions={variantOptions}
          defaultVariantId={dialog.variantId}
          defaultMode={dialog.mode}
          catalogsUnavailable={catalogDenied}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            register.reload()
            picker.reload()
            summary.reload()
          }}
        />
      ) : null}

      {/* Health summary — global truth, independent of the list filter below,
          AND the three interactive stock-level filters for the register. */}
      {summary.loading && !health ? (
        <StripSkeleton tiles={3} />
      ) : health ? (
        <StatStrip>
          <Stat
            label={t('inventory.summaryAvailable')}
            value={formatCount(health.available, locale)}
            tone="success"
            active={level === 'available'}
            onClick={() => toggleLevel('available')}
          />
          <Stat
            label={t('inventory.summaryLow')}
            value={formatCount(health.low, locale)}
            tone="warning"
            active={level === 'low'}
            onClick={() => toggleLevel('low')}
          />
          <Stat
            label={t('inventory.summaryOut')}
            value={formatCount(health.out, locale)}
            tone="danger"
            active={level === 'out'}
            onClick={() => toggleLevel('out')}
          />
        </StatStrip>
      ) : null}

      {/* Balances */}
      <section className="lh-admin-section">
        <SectionHead title={t('inventory.lowLede')} sub={t('inventory.healthHint')} />

        <Toolbar>
          <SearchField
            value={query}
            onChange={onSearch}
            placeholder={t('inventory.searchPlaceholder')}
          />
          {level !== 'all' ? (
            <Button variant="ghost" size="sm" onClick={resetLevel}>
              {t('inventory.allLevels')}
            </Button>
          ) : null}
          {register.data ? (
            <span className="lh-admin-toolbar-count">
              {formatCount(register.data.meta.total, locale)} {t('inventory.itemsWord')}
            </span>
          ) : null}
        </Toolbar>

        {register.loading && !rows ? (
          <Panel flush>
            <RowSkeleton rows={6} />
          </Panel>
        ) : catalogDenied ? (
          <Panel>
            <AdminEmpty
              icon={<Warehouse size={22} aria-hidden="true" />}
              title={t('inventory.requiresCatalog')}
            />
          </Panel>
        ) : register.error ? (
          <ErrorState error={register.error} onRetry={register.reload} />
        ) : !rows || rows.length === 0 ? (
          <Panel>
            <AdminEmpty icon={<PackageOpen size={22} aria-hidden="true" />} title={emptyTitle} />
          </Panel>
        ) : (
          <div className={register.loading ? 'opacity-60 transition-opacity' : ''}>
            {/* Mobile list */}
            <ul className="flex flex-col gap-2 md:hidden">
              {rows.map((row) => (
                <li
                  key={row.variantId}
                  className="lh-admin-record"
                  style={{ alignItems: 'stretch', flexDirection: 'column', gap: '0.5rem' }}
                >
                  <div className="flex items-center gap-3">
                    <span className="lh-admin-record-body">
                      <span className="lh-admin-record-title">{row.productName}</span>
                      <span className="lh-admin-record-meta">
                        <span className="font-mono">{row.sku}</span>
                        <StockLevelPill level={row.level} />
                        <SellabilityChip value={row.sellability} />
                      </span>
                    </span>
                    <span className="text-lg font-bold text-ink">
                      <ReservedStockReadout
                        onHand={row.quantityOnHand}
                        reserved={row.quantityReserved}
                      />
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDialog({ variantId: row.variantId, mode: 'add' })}
                    >
                      <Plus size={14} aria-hidden="true" />
                      {t('inventory.addQ')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDialog({ variantId: row.variantId, mode: 'subtract' })}
                    >
                      <Minus size={14} aria-hidden="true" />
                      {t('inventory.subQ')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop table */}
            <Panel flush className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="lh-admin-table">
                  <thead>
                    <tr>
                      <th>{t('inventory.productColumn')}</th>
                      <th>{t('inventory.skuColumn')}</th>
                      <th className="lh-admin-td-num">{t('inventory.qohColumn')}</th>
                      <th>{t('inventory.stockColumn')}</th>
                      <th>{t('inventory.readinessColumn')}</th>
                      <th aria-label={t('common.actions')} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.variantId}>
                        <td>
                          <div className="lh-admin-cell-title">{row.productName}</div>
                        </td>
                        <td className="font-mono text-xs text-ink-2">{row.sku}</td>
                        <td className="lh-admin-td-num">
                          <span className="text-base font-bold text-ink">
                            <ReservedStockReadout
                              onHand={row.quantityOnHand}
                              reserved={row.quantityReserved}
                            />
                          </span>
                        </td>
                        <td>
                          <StockLevelPill level={row.level} />
                        </td>
                        <td>
                          <SellabilityChip value={row.sellability} />
                        </td>
                        <td className="text-end">
                          <div className="lh-admin-inline-actions justify-end">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setDialog({ variantId: row.variantId, mode: 'add' })}
                            >
                              <Plus size={14} aria-hidden="true" />
                              {t('inventory.addQ')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setDialog({ variantId: row.variantId, mode: 'subtract' })
                              }
                            >
                              <Minus size={14} aria-hidden="true" />
                              {t('inventory.subQ')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        )}

        {register.data ? <Pagination meta={register.data.meta} onPage={setPage} /> : null}
      </section>

      <MovementLedger />
    </AdminPage>
  )
}

// ---------------------------------------------------------------------------
// Ledger — activity timeline by default, detailed table on demand
// ---------------------------------------------------------------------------

function MovementLedger() {
  const t = useT()
  const locale = useLocale()
  const [advanced, setAdvanced] = useState(false)
  const [page, setPage] = useState(1)
  const [movementType, setMovementType] = useState('')

  const { data, error, loading, reload } = useResource(
    () =>
      client.listMovements({
        page,
        pageSize: 15,
        movementType: movementType || undefined,
      }),
    [page, movementType],
  )

  const skuMap = useResource(async () => {
    const rows = data?.data ?? []
    const ids = [...new Set(rows.map((row) => row.variantId))]
    const looked = await Promise.all(
      ids.map(async (id) => {
        try {
          return [id, (await client.getVariant(id)).sku] as const
        } catch {
          return null
        }
      }),
    )
    const map = new Map<string, string>()
    for (const entry of looked) if (entry) map.set(entry[0], entry[1])
    return map
  }, [data])

  const rows = data?.data ?? []

  return (
    <section className="lh-admin-section">
      <SectionHead
        title={t('inventory.historyTitle')}
        sub={t('inventory.historyHint')}
        action={
          <Button variant="ghost" size="sm" onClick={() => setAdvanced((v) => !v)}>
            {advanced ? t('inventory.historyBasic') : t('inventory.historyAdvanced')}
          </Button>
        }
      />

      {advanced ? (
        <Toolbar>
          <Select
            aria-label={t('inventory.allTypes')}
            value={movementType}
            onChange={(e) => {
              setMovementType(e.target.value)
              setPage(1)
            }}
            className="lh-admin-toolbar-field basis-56"
          >
            <option value="">{t('inventory.allTypes')}</option>
            {MOVEMENT_TYPE_ORDER.map((type) => (
              <option key={type} value={type}>
                {localizedLabel(INVENTORY_MOVEMENT_TYPE_LABELS, type, locale)}
              </option>
            ))}
          </Select>
        </Toolbar>
      ) : null}

      <Panel flush>
        {loading && !data ? (
          <RowSkeleton rows={5} />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <AdminEmpty
            icon={<Warehouse size={22} aria-hidden="true" />}
            title={t('inventory.empty')}
          />
        ) : advanced ? (
          <div className="overflow-x-auto">
            <table className="lh-admin-table">
              <thead>
                <tr>
                  <th>{t('inventory.skuColumn')}</th>
                  <th>{t('inventory.movementType')}</th>
                  <th className="lh-admin-td-num">{t('inventory.quantityChange')}</th>
                  <th>{t('common.createdAt')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((move) => (
                  <tr key={move.id}>
                    <td>
                      <span className="font-mono text-xs">
                        {skuMap.data?.get(move.variantId) ?? move.variantId.slice(0, 8)}
                      </span>
                      {move.reason ? (
                        <span className="ms-2 text-xs text-ink-3" dir="auto">
                          {move.reason}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-ink-2">{movementEventLabel(move, t)}</td>
                    <td
                      className={`lh-admin-td-num font-semibold ${move.quantityChange > 0 ? 'text-success' : 'text-danger'}`}
                    >
                      {move.quantityChange > 0
                        ? `+${move.quantityChange}`
                        : String(move.quantityChange)}
                    </td>
                    <td className="text-ink-3">{formatRelative(move.createdAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="lh-admin-activity">
            {rows.map((move) => (
              <li key={move.id} className="lh-admin-activity-item">
                <span
                  className={`lh-admin-activity-dot${move.quantityChange > 0 ? ' lh-admin-activity-dot--in' : ' lh-admin-activity-dot--out'}`}
                  aria-hidden="true"
                />
                <div>
                  <p className="lh-admin-activity-text">
                    {movementEventLabel(move, t)}
                    {move.reason ? <span className="text-ink-3"> — {move.reason}</span> : null}
                  </p>
                  <p className="lh-admin-activity-meta">
                    {(skuMap.data?.get(move.variantId) ?? '') &&
                      `${skuMap.data?.get(move.variantId)} · `}
                    {formatRelative(move.createdAt, locale)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {data ? <Pagination meta={data.meta} onPage={setPage} /> : null}
    </section>
  )
}
