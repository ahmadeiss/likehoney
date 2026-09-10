'use client'

import Image from 'next/image'
import Link from 'next/link'
import type { ReactElement } from 'react'

import { copy } from '../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../lib/shop/locale'

/**
 * Cocoa footer: brand + about, a short Explore column (only real surface
 * links — V1 has no CMS pages, so no dead "Exchange policy"/"FAQ" links),
 * and a truthful Contact column built from the store's actual commitments
 * (cash on delivery, delivery to your zone, phone confirmation).
 */
export function SiteFooter(): ReactElement {
  const { lang } = useStorefrontLang()
  const t = copy[lang].footer
  const checkout = copy[lang].checkout

  const explore: { label: string; href: string }[] = [
    { label: t.exploreLinks[0] ?? copy[lang].nav.catalog, href: '/shop' },
    { label: t.exploreLinks[3] ?? copy[lang].nav.home, href: '/#our-world' },
    { label: lang === 'ar' ? 'شاركنا تجربتك' : 'Write a review', href: '/shop/review' },
  ]

  const contact: string[] = [checkout.trustNote, copy[lang].hero.kicker]

  return (
    <footer className="lh-footer">
      <div className="lh-footer__top lh-wrap">
        <div className="lh-footer__brand">
          <Image
            src="/brand/merch/main-logo-bg.png"
            alt="Like Honey — زي العسل"
            width={48}
            height={48}
            className="lh-footer__logo"
          />
          <p className="lh-footer__about">{t.about}</p>
        </div>

        <nav aria-label={t.explore}>
          <h2 className="lh-footer__heading">{t.explore}</h2>
          <ul className="lh-footer__links">
            {explore.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="lh-footer__link">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className="lh-footer__heading">{t.contact}</h2>
          <ul className="lh-footer__links">
            {contact.map((line) => (
              <li key={line}>
                <span className="lh-footer__link" style={{ cursor: 'default' }}>
                  {line}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="lh-footer__bottom lh-wrap">
        <p className="lh-footer__copy">{t.rights}</p>
      </div>
    </footer>
  )
}
