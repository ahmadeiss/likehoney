'use client'

import Link from 'next/link'
import { useCatalogProducts } from '../../../../lib/shop/use-catalog-products'
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { shopClient, type PublicCategoryDoc } from '../../../../lib/shop/client'
import { useStorefrontLang } from '../../../../lib/shop/locale'
import { ProductCard } from '../product/product-card'
import { LazyOptionSheet as OptionSheet } from '../product/lazy-option-sheet'

const PAGE_SIZE = 12
/** Paginated real catalog, with server-side category filtering. */
export function FeaturedProducts() {
  const { isAr } = useStorefrontLang()
  const [categories, setCategories] = useState<PublicCategoryDoc[]>([])
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [sheetProductId, setSheetProductId] = useState<string | null>(null)
  const { result: current, retry } = useCatalogProducts(page, category, '')
  const pages = current ? Math.ceil(current.total / PAGE_SIZE) : 0

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

  function selectCategory(slug: string) {
    setCategory(slug)
    setPage(1)
  }
  function changePage(next: number) {
    setPage(next)
    document.getElementById('collection')?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    })
  }

  return (
    <section className="lh-section collection" id="collection" aria-labelledby="collection-title">
      <div className="lh-wrap">
        <header className="lh-section-head lh-section-head--split">
          <div>
            <p className="brand-eyebrow">{isAr ? 'اختيارات زي العسل' : 'THE LIKE HONEY EDIT'}</p>
            <h2 className="lh-section-title" id="collection-title">
              {isAr ? 'تفاصيل صغيرة، فرحة كبيرة.' : 'Little finds. Big smiles.'}
            </h2>
            <p className="lh-section-sub">
              {isAr
                ? 'تصفّحوا التشكيلة، واختاروا ما يناسب يومهم.'
                : 'Explore the collection. Find something for their everyday.'}
            </p>
          </div>
          <Link href="/shop" className="atelier-text-link">
            {isAr ? 'المتجر بالكامل' : 'The complete collection'}
            {isAr ? <ArrowLeft size={20} /> : <ArrowRight size={20} />}
          </Link>
        </header>
        <div className="collection-toolbar">
          <div
            className="collection-filters"
            role="group"
            aria-label={isAr ? 'تصفية حسب القسم' : 'Filter by category'}
          >
            <button type="button" aria-pressed={category === ''} onClick={() => selectCategory('')}>
              {isAr ? 'الكل' : 'All pieces'}
            </button>
            {categories.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={category === item.slug}
                onClick={() => selectCategory(item.slug)}
              >
                {isAr ? item.nameAr : item.nameEn}
              </button>
            ))}
          </div>
          <span className="collection-count" role="status">
            {current && !current.failed
              ? `${current.total} ${isAr ? 'منتج' : 'products'}`
              : isAr
                ? 'التشكيلة'
                : 'Collection'}
          </span>
        </div>
        <div aria-busy={!current}>
          {!current ? (
            <div className="lh-grid" aria-label={isAr ? 'جارٍ تحميل المنتجات' : 'Loading products'}>
              {Array.from({ length: 4 }, (_, i) => (
                <div className="collection-skeleton" key={i} aria-hidden="true">
                  <div className="lh-skel" />
                  <div className="lh-skel" />
                </div>
              ))}
            </div>
          ) : current.failed ? (
            <div className="lh-empty" role="status">
              <h3 className="lh-empty__title">
                {isAr ? 'تعذّر تحميل التشكيلة' : 'Unable to load the collection'}
              </h3>
              <p>
                {isAr
                  ? 'جرّب مرة ثانية، اختياراتنا بانتظارك.'
                  : 'Please try again to explore the collection.'}
              </p>
              <button className="lh-btn lh-btn--secondary" onClick={retry} type="button">
                <RotateCcw size={17} />
                {isAr ? 'إعادة المحاولة' : 'Try again'}
              </button>
            </div>
          ) : current.products.length === 0 ? (
            <div className="lh-empty">
              <h3 className="lh-empty__title">
                {isAr ? 'ترقّبوا اختيارات جديدة' : 'New finds are on their way'}
              </h3>
              <p>
                {isAr
                  ? 'لا توجد منتجات في هذا القسم حاليًا. اكتشفوا باقي التشكيلة.'
                  : 'There are no products in this category yet. Explore the rest of the collection.'}
              </p>
              {category && (
                <button
                  type="button"
                  className="lh-btn lh-btn--secondary"
                  onClick={() => selectCategory('')}
                >
                  {isAr ? 'عرض الكل' : 'See all pieces'}
                </button>
              )}
            </div>
          ) : (
            <div className="lh-grid">
              {current.products.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  seedIndex={index}
                  onChooseOption={(p) => setSheetProductId(p.id)}
                />
              ))}
            </div>
          )}
        </div>
        {current && !current.failed && pages > 1 && (
          <nav
            className="collection-pagination"
            aria-label={isAr ? 'صفحات المنتجات' : 'Product pages'}
          >
            <button
              type="button"
              className="lh-btn lh-btn--secondary"
              disabled={page === 1}
              onClick={() => changePage(page - 1)}
            >
              {isAr ? 'السابق' : 'Previous'}
            </button>
            <span aria-live="polite">
              {page} / {pages}
            </span>
            <button
              type="button"
              className="lh-btn lh-btn--secondary"
              disabled={page >= pages}
              onClick={() => changePage(page + 1)}
            >
              {isAr ? 'التالي' : 'Next'}
            </button>
          </nav>
        )}
        {sheetProductId && (
          <OptionSheet productId={sheetProductId} onClose={() => setSheetProductId(null)} />
        )}
      </div>
    </section>
  )
}
