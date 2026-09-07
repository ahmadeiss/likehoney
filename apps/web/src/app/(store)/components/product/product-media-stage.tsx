import Image from 'next/image'
import type { ReactElement } from 'react'

const EMPTY_TONES = ['#08afd0', '#fa6b94', '#ffbf24', '#c91850'] as const

function HexGlyph({ tone }: { tone: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="lh-media-empty__hex"
      aria-hidden="true"
      style={{ fill: tone }}
    >
      <path d="M12 1.5 20.1 6v12L12 22.5 3.9 18V6L12 1.5Z" />
    </svg>
  )
}

/**
 * The one media surface for product imagery across the storefront.
 *
 * Actual product photography only. Missing media uses a labelled neutral
 * stage with a brand-coloured glyph, never decorative merchandise or a logo.
 */
export function ProductMediaStage({
  imageUrl,
  alt,
  seedIndex = 0,
  sizes,
  noImageLabel,
  priority = false,
}: {
  imageUrl: string | null
  categoryCode?: string | null
  alt: string
  seedIndex?: number
  sizes: string
  noImageLabel: string
  priority?: boolean
}): ReactElement {
  const src = imageUrl

  if (!src) {
    const tone = EMPTY_TONES[Math.abs(seedIndex) % EMPTY_TONES.length] ?? ''
    return (
      <div className="lh-media-empty" aria-label={noImageLabel} role="img">
        <HexGlyph tone={tone} />
        <span>{noImageLabel}</span>
      </div>
    )
  }

  return (
    <div className="lh-media-stage">
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        className="lh-media-stage__img"
        priority={priority}
      />
    </div>
  )
}
