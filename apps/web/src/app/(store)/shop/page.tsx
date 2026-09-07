'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, ArrowLeft, ArrowRight, X, RotateCcw } from 'lucide-react'
import { Suspense, useEffect, useState, type FormEvent } from 'react'
import { shopClient, type PublicCategoryDoc } from '../../../lib/shop/client'
import { useCatalogProducts } from '../../../lib/shop/use-catalog-products'
import {
  CATALOG_PAGE_SIZE,
  catalogPages,
  parseCatalogPage,
} from '../../../lib/shop/catalog-pagination'
import { useStorefrontLang } from '../../../lib/shop/locale'
import { ProductCard } from '../components/product/product-card'

import { LazyOptionSheet as OptionSheet } from '../components/product/lazy-option-sheet'

function CatalogSearch({
  value,
  onSearch,
  isAr,
}: {
  value: string
  onSearch: (value: string) => void
  isAr: boolean
}) {
  const [draft, setDraft] = useState(value)
  function submit(event: FormEvent) {
    event.preventDefault()
    onSearch(draft.trim())
  }
  return (
    <form className="catalog-search" role="search" onSubmit={submit}>
      <Search size={20} aria-hidden="true" />
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label={isAr ? 'ابحث عن منتج' : 'Search products'}
        placeholder={isAr ? 'شو بتدوروا لصغاركم؟' : 'What are you looking for?'}
      />
      <button type="submit">{isAr ? 'بحث' : 'Search'}</button>
    </form>
  )
}
function CatalogSkeleton() {
  return (
    <div className="lh-grid catalog-grid" aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="collection-skeleton" aria-hidden="true">
          <div className="lh-skel" />
          <div className="lh-skel" />
        </div>
      ))}
    </div>
  )
}

function ShopInner() {
  const { isAr } = useStorefrontLang()
  const router = useRouter()
  const params = useSearchParams()
  const search = params.get('search') ?? ''
  const category = params.get('category') ?? ''
  const page = parseCatalogPage(params.get('page'))
  const [categories, setCategories] = useState<PublicCategoryDoc[]>([])
  const [sheetProductId, setSheetProductId] = useState<string | null>(null)
  const { result, retry } = useCatalogProducts(page, category, search)
  const totalPages = result ? Math.max(1, Math.ceil(result.total / CATALOG_PAGE_SIZE)) : 1
  const active = categories.find((item) => item.slug === category)
  const activeName = active ? (isAr ? active.nameAr : active.nameEn) : category
  const Arrow = isAr ? ArrowLeft : ArrowRight
  useEffect(() => {
    let cancelled = false
    shopClient
      .listCategories()
      .then(({ data }) => {
        if (!cancelled) setCategories(data)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  function href(nextPage: number, nextCategory = category, nextSearch = search) {
    const query = new URLSearchParams()
    if (nextCategory) query.set('category', nextCategory)
    if (nextSearch) query.set('search', nextSearch)
    if (nextPage > 1) query.set('page', String(nextPage))
    return `/shop${query.size ? `?${query}` : ''}`
  }
  return (
    <div className="catalog-page">
      <div className="lh-wrap">
        <nav className="catalog-breadcrumb" aria-label={isAr ? 'مسار الصفحة' : 'Breadcrumb'}>
          <Link href="/">{isAr ? 'الرئيسية' : 'Home'}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{isAr ? 'المتجر' : 'Shop'}</span>
        </nav>
        <header className="catalog-heading">
          <div>
            <p className="brand-eyebrow">
              {isAr ? 'كل اختيارات زي العسل' : 'THE COMPLETE LIKE HONEY COLLECTION'}
            </p>
            <h1>{isAr ? 'عالمهم. على ذوقكم.' : 'Their world. Your pick.'}</h1>
            <p>
              {isAr
                ? 'قطع ليوم المدرسة، للّعب، ولأحلى الطلعات. اختاروا القسم وابدؤوا من هون.'
                : 'School days, play days, and their next adventure. Find their favourites here.'}
            </p>
          </div>
          <span className="catalog-heading__note">
            {isAr ? 'تفاصيل صغيرة تستحق الاختيار' : 'Little details, thoughtfully chosen'}
          </span>
        </header>
        <div className="catalog-layout">
          <aside className="catalog-sidebar" aria-label={isAr ? 'أقسام المتجر' : 'Shop categories'}>
            <h2>{isAr ? 'تسوّق حسب القسم' : 'Shop by category'}</h2>
            <nav>
              <Link
                href={href(1, '')}
                aria-current={!category ? 'true' : undefined}
                prefetch={false}
              >
                {isAr ? 'جميع المنتجات' : 'All products'}
                <Arrow size={17} />
              </Link>
              {categories.map((item) => (
                <Link
                  key={item.id}
                  href={href(1, item.slug)}
                  aria-current={category === item.slug ? 'true' : undefined}
                  prefetch={false}
                >
                  {isAr ? item.nameAr : item.nameEn}
                  <Arrow size={17} />
                </Link>
              ))}
            </nav>
            <div className="catalog-sidebar__note">
              <span />
              {isAr
                ? 'اختيارات ترافق كل يوم من أيامهم.'
                : 'Little finds for every day of their world.'}
            </div>
          </aside>
          <section className="catalog-results" aria-label={isAr ? 'المنتجات' : 'Products'}>
            <CatalogSearch
              key={`${search}:${category}`}
              value={search}
              isAr={isAr}
              onSearch={(value) => router.push(href(1, category, value), { scroll: false })}
            />
            <div className="catalog-summary">
              <p role="status">
                {!result
                  ? isAr
                    ? 'جارٍ تحميل التشكيلة…'
                    : 'Loading the collection…'
                  : result.failed
                    ? isAr
                      ? 'تعذّر الاتصال'
                      : 'Unable to connect'
                    : result.total > 0 && page <= totalPages
                      ? `${(page - 1) * CATALOG_PAGE_SIZE + 1}–${Math.min(page * CATALOG_PAGE_SIZE, result.total)} ${isAr ? 'من' : 'of'} ${result.total} ${isAr ? 'منتج' : 'products'}`
                      : isAr
                        ? 'لا توجد نتائج'
                        : 'No results'}
              </p>
              <span>{isAr ? '12 منتجًا في الصفحة' : '12 products per page'}</span>
            </div>
            {(category || search) && (
              <div className="catalog-active">
                {category && (
                  <Link
                    href={href(1, '')}
                    aria-label={isAr ? `إزالة قسم ${activeName}` : `Remove ${activeName} filter`}
                  >
                    {activeName}
                    <X size={14} />
                  </Link>
                )}
                {search && (
                  <Link
                    href={href(1, category, '')}
                    aria-label={isAr ? 'إزالة البحث' : 'Clear search'}
                  >
                    “{search}”<X size={14} />
                  </Link>
                )}
                <Link href="/shop">{isAr ? 'مسح الكل' : 'Clear all'}</Link>
              </div>
            )}
            <div aria-busy={!result}>
              {!result ? (
                <CatalogSkeleton />
              ) : result.failed ? (
                <div className="lh-empty">
                  <h2 className="lh-empty__title">
                    {isAr ? 'خلّينا نجرّب مرة ثانية' : 'Let’s try that again'}
                  </h2>
                  <p>
                    {isAr
                      ? 'تعذّر تحميل المنتجات. حاول من جديد.'
                      : 'We could not load the products. Please try again.'}
                  </p>
                  <button type="button" className="lh-btn lh-btn--secondary" onClick={retry}>
                    <RotateCcw size={17} />
                    {isAr ? 'إعادة المحاولة' : 'Try again'}
                  </button>
                </div>
              ) : !result.products.length ? (
                <div className="lh-empty">
                  <Search size={30} aria-hidden="true" />
                  <h2 className="lh-empty__title">
                    {isAr ? 'ما لقينا منتجات هون' : 'No little finds here yet'}
                  </h2>
                  <p>
                    {isAr
                      ? 'جرّب كلمة ثانية أو ارجع للتشكيلة.'
                      : 'Try another search or explore the collection.'}
                  </p>
                  <Link className="atelier-button" href={page > totalPages ? href(1) : '/shop'}>
                    {isAr ? 'العودة للمنتجات' : 'Back to products'}
                  </Link>
                </div>
              ) : (
                <div className="lh-grid catalog-grid">
                  {result.products.map((product, index) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      seedIndex={index}
                      priority={index < 2}
                      onChooseOption={(item) => setSheetProductId(item.id)}
                    />
                  ))}
                </div>
              )}
            </div>
            {result && !result.failed && totalPages > 1 && (
              <nav
                className="catalog-pagination"
                aria-label={isAr ? 'صفحات المنتجات' : 'Product pages'}
              >
                {page > 1 ? (
                  <Link
                    href={href(Math.min(page - 1, totalPages))}
                    prefetch={false}
                    aria-label={isAr ? 'الصفحة السابقة' : 'Previous page'}
                  >
                    {isAr ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
                  </Link>
                ) : (
                  <span aria-disabled="true">
                    {isAr ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
                  </span>
                )}
                {catalogPages(page, totalPages).map((item, index) =>
                  item === 'gap' ? (
                    <span key={`gap-${index}`}>…</span>
                  ) : (
                    <Link
                      key={item}
                      href={href(item)}
                      prefetch={false}
                      aria-label={isAr ? `صفحة ${item}` : `Page ${item}`}
                      aria-current={page === item ? 'page' : undefined}
                    >
                      {item}
                    </Link>
                  ),
                )}
                {page < totalPages ? (
                  <Link
                    href={href(page + 1)}
                    prefetch={false}
                    aria-label={isAr ? 'الصفحة التالية' : 'Next page'}
                  >
                    <Arrow size={18} />
                  </Link>
                ) : (
                  <span aria-disabled="true">
                    <Arrow size={18} />
                  </span>
                )}
              </nav>
            )}
          </section>
        </div>
      </div>
      {sheetProductId && (
        <OptionSheet productId={sheetProductId} onClose={() => setSheetProductId(null)} />
      )}
    </div>
  )
}

export default function ShopPage() {
  return (
    <Suspense
      fallback={
        <div className="lh-wrap lh-section">
          <CatalogSkeleton />
        </div>
      }
    >
      <ShopInner />
    </Suspense>
  )
}
