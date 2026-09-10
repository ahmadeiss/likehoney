import type { ReactNode } from 'react'

import { StorefrontLangProvider } from '../../lib/shop/locale'
import { CartDock } from './components/cart/cart-dock'
import { SiteFooter } from './components/storefront/site-footer'
import { SiteHeader } from './components/storefront/site-header'
import { SkipLink } from './components/storefront/skip-link'
import './styles/storefront.css'
import './styles/atelier.css'
import './styles/hive.css'

/**
 * Public storefront shell — LIKE HONEY premium kids retail.
 *
 * The storefront has been rebuilt from zero (the rejected generic whimiscal
 * presentation is gone). This shell provides the shared chrome only:
 * skip-link, announcement + header (scroll-solid, mobile drawer, search
 * overlay, language toggle, live cart badge), the `<main>` landmark, and the
 * cocoa footer. Direction handling stays with `StorefrontLangProvider`
 * (Arabic RTL by default, English LTR); the design system is scoped under the
 * `.lh` namespace so it cannot leak into Admin.
 */
export default function StoreLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="lh">
      <StorefrontLangProvider>
        <SkipLink />
        <SiteHeader />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
        <CartDock />
      </StorefrontLangProvider>
    </div>
  )
}
