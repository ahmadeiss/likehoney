'use client'

import { ShoppingBag, PhoneCall, Sparkles } from 'lucide-react'
import type { ReactElement } from 'react'

import { copy } from '../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../lib/shop/locale'

/**
 * Trust strip — the store's real operating promises only: Cash on Delivery,
 * personal phone confirmation before delivery, and a hand-curated catalog.
 * No invented guarantees, no fake "worldwide shipping" badges.
 */
export function TrustStrip(): ReactElement {
  const { lang } = useStorefrontLang()
  const t = copy[lang].trust

  const items = [
    {
      icon: ShoppingBag,
      title: lang === 'ar' ? 'عالمهم في مكان واحد' : 'Their world, in one place',
      body:
        lang === 'ar'
          ? 'ملابس وأحذية وحقائب وألعاب، لتفاصيل يومهم.'
          : 'Clothing, shoes, bags and toys for their everyday.',
    },
    { icon: PhoneCall, title: t.careTitle, body: t.careBody },
    { icon: Sparkles, title: t.curatedTitle, body: t.curatedBody },
  ]

  return (
    <section className="lh-trust lh-section lh-section--tight">
      <div className="lh-wrap">
        <div className="lh-trust__grid">
          {items.map(({ icon: Icon, title, body }) => (
            <div className="lh-trust-item" key={title}>
              <div className="lh-trust-item__icon">
                <Icon aria-hidden="true" />
              </div>
              <div>
                <h3 className="lh-trust-item__title">{title}</h3>
                <p className="lh-trust-item__body">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
