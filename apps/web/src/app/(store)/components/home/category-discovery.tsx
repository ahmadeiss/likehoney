'use client'

import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, ArrowRight, Backpack, Shirt, Footprints, Puzzle, Gift } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'

import { categoryIconComponent, resolveCategoryVisual } from '../../../../lib/category-icons'
import { shopClient, type PublicCategoryDoc } from '../../../../lib/shop/client'
import { copy } from '../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../lib/shop/locale'

const CATEGORY_ICONS: Record<string, typeof Gift> = {
  BAGS: Backpack,
  CLOTH: Shirt,
  SHOES: Footprints,
  TOYS: Puzzle,
}

/**
 * Shop-by-category discovery. Renders the REAL categories from the public
 * API — every numbered card links to `/shop?category={slug}`. No decorative
 * imagery. The anchor stays available even when categories cannot be loaded.
 */
export function CategoryDiscovery(): ReactElement | null {
  const { lang, isAr } = useStorefrontLang()
  const t = copy[lang]
  const [categories, setCategories] = useState<PublicCategoryDoc[] | null>(null)

  useEffect(() => {
    let cancelled = false
    shopClient
      .listCategories()
      .then((res) => {
        if (!cancelled) setCategories(res.data)
      })
      .catch(() => {
        if (!cancelled) setCategories([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="lh-section" id="categories">
      <div className="lh-wrap">
        <header className="lh-section-head">
          <h2 className="lh-section-title">{t.discovery.title}</h2>
          <p className="lh-section-sub">{t.discovery.sub}</p>
        </header>

        {!categories || categories.length === 0 ? (
          <Link className="atelier-text-link" href="/shop">
            {isAr ? 'تصفّح كل التشكيلة' : 'Browse the whole collection'}
            {isAr ? <ArrowLeft size={18} /> : <ArrowRight size={18} />}
          </Link>
        ) : (
          <div className="lh-cats__grid">
            {categories.map((category, index) => {
              const name = isAr ? category.nameAr : category.nameEn
              const Icon = CATEGORY_ICONS[category.code.toUpperCase()] ?? Gift
              const visual = resolveCategoryVisual(category)
              const CustomIcon =
                visual === 'icon' && category.iconKey !== null
                  ? categoryIconComponent(category.iconKey)
                  : undefined
              return (
                <Link
                  key={category.id}
                  href={`/shop?category=${category.slug}`}
                  className="lh-cat-card"
                >
                  <div className="lh-cat-card__media" aria-hidden="true">
                    {visual === 'image' ? (
                      <div className="lh-cat-card__image">
                        <Image
                          src={category.imageUrl!}
                          alt=""
                          fill
                          sizes="210px"
                          className="lh-cat-card__image-img"
                        />
                      </div>
                    ) : (
                      <>
                        {CustomIcon !== undefined ? (
                          <CustomIcon className="hive-category-icon" strokeWidth={1.3} />
                        ) : (
                          <Icon className="hive-category-icon" strokeWidth={1.3} />
                        )}
                        <span className="lh-cat-card__initial">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="lh-cat-card__body">
                    <h3 className="lh-cat-card__name">{name}</h3>
                    <span className="lh-cat-card__arrow" aria-hidden="true">
                      {isAr ? <ArrowLeft /> : <ArrowRight />}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
