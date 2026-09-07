'use client'

import Image from 'next/image'
import { useState, type ReactElement } from 'react'

import type { PublicProductDetail } from '../../../../lib/shop/client'
import { useStorefrontLang } from '../../../../lib/shop/locale'
import { ProductMediaStage } from './product-media-stage'

/**
 * Product Detail's media gallery — real `product.media` only, primary first.
 * A single item renders as one large stage; multiple items add a compact
 * thumbnail rail. No media at all falls back through the same empty-state
 * chain as every other product surface (never a fake photo, never the bee).
 */
export function ProductGallery({
  media,
  categoryCode,
  fallbackAlt,
  noImageLabel,
}: {
  media: PublicProductDetail['media']
  categoryCode?: string | null
  fallbackAlt: string
  noImageLabel: string
}): ReactElement {
  const { isAr } = useStorefrontLang()
  const ordered = [...media].sort((a, b) =>
    a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1,
  )
  const [activeId, setActiveId] = useState(ordered[0]?.id)
  const active = ordered.find((item) => item.id === activeId) ?? ordered[0]

  if (!active) {
    return (
      <div className="lh-gallery">
        <div className="lh-gallery__main">
          <ProductMediaStage
            imageUrl={null}
            categoryCode={categoryCode}
            alt={fallbackAlt}
            noImageLabel={noImageLabel}
            sizes="(min-width: 60rem) 45vw, 100vw"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="lh-gallery">
      <div className="lh-gallery__main">
        {active.mediaType === 'image' ? (
          <Image
            src={active.url}
            alt={isAr ? (active.altAr ?? fallbackAlt) : (active.altEn ?? fallbackAlt)}
            fill
            sizes="(min-width: 60rem) 45vw, 100vw"
            priority
            className="lh-gallery__img"
          />
        ) : (
          <video src={active.url} className="lh-gallery__img" autoPlay muted loop playsInline />
        )}
      </div>

      {ordered.length > 1 ? (
        <div className="lh-gallery__thumbs" role="tablist" aria-label={fallbackAlt}>
          {ordered.map((item) => (
            <button
              key={item.id}
              type="button"
              className="lh-gallery__thumb"
              aria-pressed={item.id === active.id}
              onClick={() => setActiveId(item.id)}
            >
              {item.mediaType === 'image' ? (
                <Image src={item.url} alt="" fill sizes="3.5rem" />
              ) : (
                <span className="lh-gallery__thumb-video" aria-hidden="true">
                  ▶
                </span>
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
