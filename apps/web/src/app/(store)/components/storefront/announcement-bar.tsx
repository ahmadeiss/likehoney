'use client'

import type { ReactElement } from 'react'

import { useStorefrontLang } from '../../../../lib/shop/locale'

/**
 * Thin cocoa announcement strip above the store header. Plain, factual,
 * bilingual — a single promise (delivery + cash on delivery), never a fake
 * sale banner or countdown.
 */
const ANNOUNCE: Record<'ar' | 'en', { lead: string; tail: string }> = {
  ar: { lead: 'زي العسل', tail: 'تفاصيل يحبّها الصغار، ويختارها الأهل' },
  en: { lead: 'Like Honey', tail: 'Loved by little ones. Chosen by you.' },
}

export function AnnouncementBar(): ReactElement {
  const { lang } = useStorefrontLang()
  const t = ANNOUNCE[lang]
  return (
    <p className="lh-announce" role="note">
      <span className="lh-announce__lead">{t.lead}</span>
      <span className="lh-announce__dot" aria-hidden="true" />
      <span className="lh-announce__tail">{t.tail}</span>
    </p>
  )
}
