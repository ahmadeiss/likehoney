'use client'

import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { client, type ProductDoc } from '../../../lib/admin/client'
import { subscribeCatalog } from '../../../lib/admin/revalidate'
import { useAuth } from '../../../lib/admin/auth'
import { useT, type DictKey } from '../../../lib/admin/i18n'

interface PageTarget {
  href: string
  labelKey: DictKey
  permission?: string
}

const PAGE_TARGETS: PageTarget[] = [
  { href: '/admin', labelKey: 'shell.nav.dashboard' },
  { href: '/admin/products', labelKey: 'shell.nav.products', permission: 'catalog:read' },
  { href: '/admin/products/new', labelKey: 'products.new', permission: 'catalog:write' },
  { href: '/admin/store-sales', labelKey: 'shell.nav.storeSales', permission: 'store-sales:read' },
  { href: '/admin/inventory', labelKey: 'shell.nav.inventory', permission: 'inventory:read' },
  { href: '/admin/categories', labelKey: 'shell.nav.categories', permission: 'catalog:read' },
  { href: '/admin/suppliers', labelKey: 'shell.nav.suppliers', permission: 'catalog:read' },
  { href: '/admin/staff', labelKey: 'shell.nav.staff', permission: 'staff:write' },
  { href: '/admin/settings', labelKey: 'shell.nav.settings', permission: 'settings:write' },
]

type Row =
  | { kind: 'product'; id: string; title: string; sub: string; href: string }
  | { kind: 'page'; title: string; href: string }

/**
 * Header search. Reduces navigation by jumping straight to a product or a
 * section. Product results come from the real catalog search endpoint
 * (`GET /products?search=`); page results are the sections the current identity
 * can open. No fabricated results — an empty query shows a hint, a query with no
 * matches shows an honest empty line.
 */
export function GlobalSearch() {
  const t = useT()
  const router = useRouter()
  const { hasPermission } = useAuth()

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [products, setProducts] = useState<ProductDoc[]>([])
  const [loading, setLoading] = useState(false)
  const [activeRaw, setActiveRaw] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const canCatalog = hasPermission('catalog:read')

  // Debounce the query.
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(id)
  }, [query])

  // Re-run the search when a catalog/inventory mutation lands so status shown
  // here stays current (admin search — it lists products regardless of
  // sellability, unlike the register).
  const [catalogTick, setCatalogTick] = useState(0)
  useEffect(() => subscribeCatalog(() => setCatalogTick((n) => n + 1)), [])

  // Fetch product matches. State is only ever set from async callbacks; the
  // "too short / no permission" case is handled at render time.
  useEffect(() => {
    if (!canCatalog || debounced.length < 2) return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setLoading(true)
    })
    client
      .listProducts({ search: debounced, pageSize: 6 })
      .then((page) => {
        if (!cancelled) setProducts(page.data)
      })
      .catch(() => {
        if (!cancelled) setProducts([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced, canCatalog, catalogTick])

  // Close on outside click / Escape; open on Cmd/Ctrl+K.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const pageMatches = useMemo<Row[]>(() => {
    const q = debounced.toLowerCase()
    if (q.length < 2) return []
    return PAGE_TARGETS.filter((p) => p.permission === undefined || hasPermission(p.permission))
      .map((p) => ({ kind: 'page' as const, title: t(p.labelKey), href: p.href }))
      .filter((row) => row.title.toLowerCase().includes(q))
      .slice(0, 4)
  }, [debounced, hasPermission, t])

  const productRows = useMemo<Row[]>(
    () =>
      debounced.length < 2
        ? []
        : products.map((p) => ({
            kind: 'product' as const,
            id: p.id,
            title: p.nameAr,
            sub: p.nameEn,
            href: `/admin/products/${p.id}`,
          })),
    [products, debounced],
  )

  const rows = useMemo(() => [...productRows, ...pageMatches], [productRows, pageMatches])

  // Clamp the highlighted row instead of resetting it from an effect.
  const active = Math.min(activeRaw, Math.max(rows.length - 1, 0))

  const go = (row: Row) => {
    setOpen(false)
    setQuery('')
    setDebounced('')
    router.push(row.href)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveRaw(Math.min(active + 1, Math.max(rows.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveRaw(Math.max(active - 1, 0))
    } else if (event.key === 'Enter' && rows[active]) {
      event.preventDefault()
      go(rows[active])
    }
  }

  const showPop = open && query.trim().length > 0

  return (
    <div className="lh-admin-search" ref={rootRef}>
      <Search size={15} className="lh-admin-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className="lh-admin-search-input"
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
        value={query}
        role="combobox"
        aria-expanded={showPop}
        aria-controls="lh-admin-search-list"
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <span className="lh-admin-search-kbd" aria-hidden="true">
        ⌘K
      </span>

      {showPop ? (
        <div className="lh-admin-search-pop" id="lh-admin-search-list" role="listbox">
          {debounced.length < 2 ? (
            <p className="lh-admin-search-empty">{t('search.min')}</p>
          ) : loading && rows.length === 0 ? (
            <p className="lh-admin-search-empty">{t('search.searching')}</p>
          ) : rows.length === 0 ? (
            <p className="lh-admin-search-empty">{t('search.empty')}</p>
          ) : (
            <>
              {productRows.length > 0 ? (
                <>
                  <p className="lh-admin-search-sec">{t('search.products')}</p>
                  {productRows.map((row, i) => (
                    <a
                      key={`p-${row.kind === 'product' ? row.id : i}`}
                      href={row.href}
                      role="option"
                      aria-selected={active === i}
                      className="lh-admin-search-item"
                      onClick={(event) => {
                        event.preventDefault()
                        go(row)
                      }}
                    >
                      <span
                        className="lh-admin-thumb"
                        style={{ width: '1.75rem', height: '1.75rem' }}
                      >
                        {monogram(row.title)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{row.title}</span>
                      {row.kind === 'product' && row.sub ? (
                        <span className="lh-admin-search-item-meta truncate">{row.sub}</span>
                      ) : null}
                    </a>
                  ))}
                </>
              ) : null}
              {pageMatches.length > 0 ? (
                <>
                  <p className="lh-admin-search-sec">{t('search.pages')}</p>
                  {pageMatches.map((row, i) => {
                    const idx = productRows.length + i
                    return (
                      <a
                        key={`g-${row.href}`}
                        href={row.href}
                        role="option"
                        aria-selected={active === idx}
                        className="lh-admin-search-item"
                        onClick={(event) => {
                          event.preventDefault()
                          go(row)
                        }}
                      >
                        <span
                          className="lh-admin-thumb"
                          style={{
                            width: '1.75rem',
                            height: '1.75rem',
                            background: 'var(--lh-color-surface-muted)',
                            color: 'var(--lh-color-ink-3)',
                          }}
                        >
                          <Search size={13} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{row.title}</span>
                      </a>
                    )
                  })}
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function monogram(name: string): string {
  const clean = name.trim()
  if (clean.length === 0) return '·'
  return Array.from(clean).slice(0, 2).join('').toUpperCase()
}
