'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'

import { shopClient, type PublicCategoryDoc } from '../../../../lib/shop/client'
import { copy } from '../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../lib/shop/locale'

const TILES = [
  {
    code: 'shoes',
    scene: 1 as const,
    art: '/brand/merch/shoes.png',
  },
  {
    code: 'toys',
    scene: 2 as const,
    art: '/brand/merch/toys.png',
  },
]

/**
 * Secondary discovery — two larger "chapter" tiles for the hero categories
 * (shoes / toys), driven by the REAL catalog: each tile only renders when
 * its category actually exists, resolves its real slug from the API, and
 * links to `/shop?category={slug}`. A distinct, editorial beat between the
 * small category grid above and the cocoa editorial band — never a
 * duplicated grid.
 */
export function SecondaryDiscovery(): ReactElement | null {
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

  const tiles = TILES.map((tile) => {
    const category = categories?.find((c) => c.code === tile.code)
    return category ? { ...tile, category } : null
  }).filter((tile): tile is NonNullable<typeof tile> => tile !== null)

  if (categories === null || tiles.length === 0) return null

  return (
    <section className="lh-section lh-section--tight">
      <div className="lh-wrap">
        <div className="lh-secondary__grid">
          {tiles.map(({ category, scene, art }) => {
            const sceneCopy = t.home.scenes[scene] ?? t.home.scenes[0]
            if (!sceneCopy) return null
            const name = isAr ? category.nameAr : category.nameEn
            return (
              <Link
                key={category.id}
                href={`/shop?category=${category.slug}`}
                className="lh-secondary__tile"
              >
                <div className="lh-secondary__media" aria-hidden="true">
                  <Image src={art} alt="" width={360} height={360} />
                </div>
                <div className="lh-secondary__body">
                  <span className="lh-secondary__kicker">{sceneCopy.kicker}</span>
                  <h3 className="lh-secondary__title">{name}</h3>
                  <p className="lh-secondary__lead">{sceneCopy.lead}</p>
                  <span className="lh-secondary__cta">
                    {sceneCopy.cta}
                    {isAr ? <ArrowLeft /> : <ArrowRight />}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
