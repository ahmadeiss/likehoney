'use client'

import type { ReactElement } from 'react'

import { copy } from '../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../lib/shop/locale'

/**
 * Skip link — lets keyboard users jump straight to the storefront content,
 * bypassing announcement bar, header and navigation. Client component so the
 * label follows the active storefront language.
 */
export function SkipLink(): ReactElement {
  const { lang } = useStorefrontLang()
  return (
    <a href="#main" className="lh-skip-link">
      {copy[lang].nav.skipToContent}
    </a>
  )
}
