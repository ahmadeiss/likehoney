'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { shopClient, formatMoney, ApiError } from '../../../../../lib/shop/client'
import type { PublicProductDetail } from '../../../../../lib/shop/client'
import { copy } from '../../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../../lib/shop/locale'
import { ProductBuy } from '../../../components/product/product-buy'
import { ProductGallery } from '../../../components/product/product-gallery'

export default function ProductDetailPage() {
  const { lang } = useStorefrontLang()
  const t = copy[lang]
  const { productId } = useParams<{ productId: string }>()
  const [product, setProduct] = useState<PublicProductDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProduct(null)
    setError(null)
    shopClient
      .getProduct(productId)
      .then((data) => {
        if (!cancelled) setProduct(data)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.code === 'not_found') setError(t.errors.notFound)
        else setError(t.errors.loadFailed)
      })
    return () => {
      cancelled = true
    }
  }, [productId, lang, t.errors.loadFailed, t.errors.notFound])

  if (error) {
    return (
      <div className="lh-pdp lh-section">
        <div className="lh-wrap">
          <div className="lh-empty">
            <p className="lh-empty__title">{error}</p>
            <Link href="/shop" className="lh-btn lh-btn--secondary">
              {t.product.backToCatalog}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="lh-pdp lh-section">
        <div className="lh-wrap">
          <div className="lh-pdp__grid">
            <div className="lh-skel" style={{ aspectRatio: '1 / 1' }} />
            <div className="lh-pdp__skeleton">
              <div className="lh-skel" style={{ height: '1rem', width: '40%' }} />
              <div className="lh-skel" style={{ height: '2.25rem', width: '80%' }} />
              <div className="lh-skel" style={{ height: '1.5rem', width: '30%' }} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  const priceLabel =
    product.priceFromMinor === product.priceToMinor
      ? formatMoney(product.priceFromMinor, lang)
      : `${t.card.from} ${formatMoney(product.priceFromMinor, lang)}`

  const name = lang === 'ar' ? product.nameAr : product.nameEn

  return (
    <div className="lh-pdp lh-section">
      <div className="lh-wrap">
        <nav className="lh-pdp__crumb" aria-label={t.product.backToCatalog}>
          <Link href="/shop">{t.product.backToCatalog}</Link>
          <span aria-hidden="true">/</span>
          <span>{name}</span>
        </nav>

        <div className="lh-pdp__grid">
          <ProductGallery
            media={product.media}
            categoryCode={product.category?.code}
            fallbackAlt={name}
            noImageLabel={t.card.noImage}
          />

          <div className="lh-pdp__info">
            {product.category ? (
              <p className="lh-pdp__category">
                {lang === 'ar' ? product.category.nameAr : product.category.nameEn}
              </p>
            ) : null}
            <h1 className="lh-pdp__name">{name}</h1>
            {product.shortBlurbAr ? (
              <p className="lh-pdp__blurb">
                {lang === 'ar'
                  ? product.shortBlurbAr
                  : (product.shortBlurbEn ?? product.shortBlurbAr)}
              </p>
            ) : null}

            <p className="lh-pdp__price">{priceLabel}</p>

            <ProductBuy options={product.options} variants={product.variants} />

            {product.descriptionAr ? (
              <div className="lh-pdp__desc">
                <h2>{t.product.whatYouGet}</h2>
                <p>
                  {lang === 'ar'
                    ? product.descriptionAr
                    : (product.descriptionEn ?? product.descriptionAr)}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
