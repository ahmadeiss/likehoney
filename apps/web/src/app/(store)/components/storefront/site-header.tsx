'use client'

import { AnimatePresence, motion } from 'motion/react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, Search, ShoppingBag, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'

import { useCartCount } from '../../../../lib/shop/cart'
import { copy } from '../../../../lib/shop/copy'
import { useStorefrontLang } from '../../../../lib/shop/locale'
import { AnnouncementBar } from './announcement-bar'

const NAV_LINKS = [
  { href: '/', key: 'home' },
  { href: '/shop', key: 'catalog' },
] as const

/**
 * Sticky store header: logo, primary nav, compact search field (wide
 * desktop), language toggle and the live cart badge. On tablet/mobile the
 * nav collapses into a slide-in drawer and search opens as a top overlay —
 * both driven by the `.lh` design system and gently animated with motion
 * (respecting `prefers-reduced-motion` via the CSS layer).
 */
export function SiteHeader(): ReactElement {
  const { lang, isAr, setLang } = useStorefrontLang()
  const t = copy[lang]
  const cartCount = useCartCount()
  const pathname = usePathname()
  const router = useRouter()

  const [solid, setSolid] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const drawerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!drawerOpen && !searchOpen) return
    const panel = drawerOpen ? drawerRef.current : searchRef.current
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled])',
        ) ?? [],
      )
    focusable()[0]?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false)
        setSearchOpen(false)
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
    }
  }, [drawerOpen, searchOpen])

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close overlays on navigation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawerOpen(false)
    setSearchOpen(false)
  }, [pathname])

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const q = query.trim()
    router.push(q ? `/shop?search=${encodeURIComponent(q)}` : '/shop')
    setSearchOpen(false)
  }

  const sharedMotion = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.2 },
  }

  return (
    <>
      <header className="lh-header" data-solid={solid}>
        <AnnouncementBar />
        <div className="lh-header__bar lh-wrap--wide">
          <div className="lh-header__start">
            <button
              type="button"
              className="lh-icon-btn lh-header__menu"
              aria-label={t.nav.menu}
              aria-expanded={drawerOpen}
              aria-controls="lh-drawer"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="lh-icon-btn__svg" aria-hidden="true" />
            </button>
            <Link href="/" className="lh-logo" aria-label="Like Honey — زي العسل">
              <Image
                src="/brand/merch/like-honey-logo-primary.png"
                alt=""
                width={64}
                height={64}
                className="lh-header__logo"
                priority
              />
            </Link>
          </div>

          <nav className="lh-header__nav" aria-label={t.nav.browseStore}>
            {NAV_LINKS.map((link) => (
              <Link
                key={link.key}
                href={link.href}
                className="lh-header__link"
                aria-current={pathname === link.href ? 'page' : undefined}
              >
                {t.nav[link.key]}
              </Link>
            ))}
            <Link href="/#categories" className="lh-header__link">
              {isAr ? 'عالم الصغار' : 'Little worlds'}
            </Link>
            <Link href="/#our-world" className="lh-header__link">
              {isAr ? 'حكايتنا' : 'Our story'}
            </Link>
          </nav>

          <div className="lh-header__end">
            <button
              type="button"
              className="lh-icon-btn lh-header__search-trigger"
              aria-label={t.nav.search}
              onClick={() => setSearchOpen(true)}
            >
              <Search className="lh-icon-btn__svg" aria-hidden="true" />
            </button>

            <form className="lh-header__search-field" role="search" onSubmit={submitSearch}>
              <Search
                className="lh-icon-btn__svg"
                aria-hidden="true"
                style={{ width: 16, height: 16 }}
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.nav.searchPlaceholder}
                aria-label={t.nav.search}
              />
            </form>

            <button
              type="button"
              className="lh-lang lh-header__lang"
              onClick={() => setLang(isAr ? 'en' : 'ar')}
            >
              {t.nav.switchTo}
            </button>

            <Link href="/shop/cart" className="lh-icon-btn lh-cart" aria-label={t.nav.cartLabel}>
              <ShoppingBag className="lh-icon-btn__svg" aria-hidden="true" />
              {cartCount > 0 ? (
                <span className="lh-cart__badge" aria-hidden="true">
                  {cartCount}
                </span>
              ) : null}
            </Link>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {drawerOpen ? (
          <div key="lh-drawer">
            <motion.button
              type="button"
              className="lh-drawer__scrim"
              aria-label={t.nav.close}
              onClick={() => setDrawerOpen(false)}
              {...sharedMotion}
            />
            <motion.div
              id="lh-drawer"
              ref={drawerRef}
              className="lh-drawer__panel"
              role="dialog"
              aria-modal="true"
              aria-label={t.nav.menu}
              initial={{ x: isAr ? '100%' : '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: isAr ? '100%' : '-100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 40 }}
            >
              <div className="lh-drawer__head">
                <Image
                  src="/brand/merch/like-honey-logo-primary.png"
                  alt=""
                  width={40}
                  height={40}
                  className="lh-drawer__logo"
                />
                <button
                  type="button"
                  className="lh-icon-btn"
                  aria-label={t.nav.close}
                  onClick={() => setDrawerOpen(false)}
                >
                  <X className="lh-icon-btn__svg" aria-hidden="true" />
                </button>
              </div>

              <nav className="lh-drawer__nav" aria-label={t.nav.browseStore}>
                <Link
                  href="/"
                  className="lh-drawer__link"
                  aria-current={pathname === '/' ? 'page' : undefined}
                >
                  {t.nav.home}
                </Link>
                <Link
                  href="/shop"
                  className="lh-drawer__link"
                  aria-current={pathname.startsWith('/shop') ? 'page' : undefined}
                >
                  {t.nav.catalog}
                </Link>
                <Link href="/shop/cart" className="lh-drawer__link">
                  {t.nav.cart}
                  {cartCount > 0 ? (
                    <span className="lh-drawer__cart" aria-hidden="true">
                      {cartCount}
                    </span>
                  ) : null}
                </Link>
              </nav>

              <div className="lh-drawer__foot">
                <span className="lh-footer__copy">{t.langName}</span>
                <button
                  type="button"
                  className="lh-lang"
                  onClick={() => setLang(isAr ? 'en' : 'ar')}
                >
                  {t.nav.switchTo}
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {searchOpen ? (
          <div key="lh-search">
            <motion.button
              type="button"
              className="lh-search__scrim"
              aria-label={t.nav.close}
              onClick={() => setSearchOpen(false)}
              {...sharedMotion}
            />
            <motion.div
              className="lh-search__panel"
              ref={searchRef}
              role="dialog"
              aria-modal="true"
              aria-label={t.nav.search}
              initial={{ y: -12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0 }}
              transition={{ duration: 0.22 }}
            >
              <div className="lh-search__topline">
                <button
                  type="button"
                  className="lh-icon-btn"
                  aria-label={t.nav.close}
                  onClick={() => setSearchOpen(false)}
                >
                  <X className="lh-icon-btn__svg" aria-hidden="true" />
                </button>
              </div>
              <form className="lh-search__form" onSubmit={submitSearch}>
                <Search className="lh-icon-btn__svg" aria-hidden="true" />
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.nav.searchPlaceholder}
                  aria-label={t.nav.search}
                />
                <button type="submit" className="lh-search__submit" aria-label={t.nav.search}>
                  <Search className="lh-icon-btn__svg" aria-hidden="true" />
                </button>
              </form>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
