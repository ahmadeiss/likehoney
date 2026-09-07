'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Single source of truth for the document's language/direction.
 *
 * - The storefront is fully bilingual and can switch to English/LTR or
 *   Arabic/RTL; its preference lives in `lh:storefront:lang` (managed by the
 *   storefront locale provider in `lib/shop/locale.tsx`) and is honoured on
 *   every non-admin route.
 * - The Admin area is bilingual too; its preference lives in `lh:admin:lang`.
 *
 * Both controllers write the same document attributes, so navigating between
 * the two surfaces always reflects the correct persisted preference.
 */
export type AdminLang = 'ar' | 'en'

export type AdminDir = 'rtl' | 'ltr'

export const ADMIN_LANG_KEY = 'lh:admin:lang'

export function readAdminLang(): AdminLang {
  if (typeof window === 'undefined') return 'ar'
  const stored = window.localStorage.getItem(ADMIN_LANG_KEY)
  return stored === 'en' ? 'en' : 'ar'
}

export function writeAdminLang(lang: AdminLang): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ADMIN_LANG_KEY, lang)
}

export function applyDocumentDirection(lang: AdminLang): void {
  const dir: AdminDir = lang === 'ar' ? 'rtl' : 'ltr'
  document.documentElement.setAttribute('lang', lang)
  document.documentElement.setAttribute('dir', dir)
}

export function DirectionSync() {
  const pathname = usePathname()

  useEffect(() => {
    if (pathname.startsWith('/admin')) {
      applyDocumentDirection(readAdminLang())
    } else {
      const stored =
        typeof window !== 'undefined' ? window.localStorage.getItem('lh:storefront:lang') : null
      applyDocumentDirection(stored === 'en' ? 'en' : 'ar')
    }
  }, [pathname])

  return null
}
