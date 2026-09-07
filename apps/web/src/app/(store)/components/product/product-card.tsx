'use client'

import { ShoppingBag } from 'lucide-react'
import Link from 'next/link'
import { useState, type ReactElement } from 'react'

import { addToCart } from '../../../../lib/shop/cart'
import { formatMoney, type PublicProductListItem } from '../../../../lib/shop/client'
import { copy } from '../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../lib/shop/locale'
import { ProductMediaStage } from './product-media-stage'

/**
 * The single shared product card — used by the Shop grid and the Home
 * featured rail. Media dominates; one truthful action. Grid rendering never
 * fetches a product's full detail: a simple product quick-adds via the
 * `singleVariantId` already on the list item, an option product opens the
 * lazy bottom sheet through `onChooseOption`.
 */
export function ProductCard({
  product,
  seedIndex = 0,
  priority = false,
  onChooseOption,
}: {
  product: PublicProductListItem
  seedIndex?: number
  priority?: boolean
  onChooseOption: (product: PublicProductListItem) => void
}): ReactElement {
  const { lang, isAr } = useStorefrontLang()
  const t = copy[lang]
  const [added, setAdded] = useState(false)

  const name = isAr ? product.nameAr : product.nameEn
  const blurb = isAr ? product.shortBlurbAr : product.shortBlurbEn
  const singlePrice = product.priceFromMinor === product.priceToMinor
  const href = `/shop/product/${product.id}`

  const quickAdd = () => {
    if (!product.singleVariantId) return
    addToCart({ variantId: product.singleVariantId, quantity: 1 })
    setAdded(true)
    window.setTimeout(() => setAdded(false), 1400)
  }

  return (
    <article className="lh-product-card">
      <Link href={href} className="lh-product-card__media" aria-label={name}>
        <ProductMediaStage
          imageUrl={product.imageUrl}
          categoryCode={product.category?.code}
          alt={name}
          seedIndex={seedIndex}
          priority={priority}
          noImageLabel={t.card.noImage}
          sizes="(min-width: 80rem) 24vw, (min-width: 64rem) 30vw, (min-width: 40rem) 44vw, 92vw"
        />
        {!product.inStock ? (
          <span className="lh-product-card__badge">{t.card.outOfStock}</span>
        ) : null}
      </Link>

      <div className="lh-product-card__body">
        {product.category ? (
          <p className="lh-product-card__cat">
            {isAr ? product.category.nameAr : product.category.nameEn}
          </p>
        ) : null}
        <Link href={href} className="lh-product-card__name" title={name}>
          {name}
        </Link>
        {blurb ? <p className="collection-product-blurb">{blurb}</p> : null}
        <p className="lh-product-card__price">
          {!singlePrice ? <span className="lh-card__from">{t.card.from} </span> : null}
          {formatMoney(product.priceFromMinor, lang)}
        </p>
        <span className="collection-product-availability" data-available={product.inStock}>
          <span aria-hidden="true" />
          {product.inStock ? (isAr ? 'متوفر الآن' : 'Available now') : t.card.outOfStock}
        </span>
      </div>

      <div className="lh-product-card__actions">
        {!product.inStock ? (
          <button type="button" className="lh-btn lh-btn--secondary" disabled>
            {t.card.outOfStock}
          </button>
        ) : product.hasOptions ? (
          <button
            type="button"
            className="lh-btn lh-btn--secondary"
            onClick={() => onChooseOption(product)}
          >
            <ShoppingBag className="lh-btn__icon" aria-hidden="true" />
            {t.card.choose}
          </button>
        ) : (
          <button
            type="button"
            className="lh-btn lh-btn--primary"
            onClick={quickAdd}
            disabled={!product.singleVariantId}
          >
            <ShoppingBag className="lh-btn__icon" aria-hidden="true" />
            {added ? t.product.added : t.card.add}
          </button>
        )}
      </div>
    </article>
  )
}
