'use client'

import { LayoutDashboard, Languages, Store } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { cx, IconButton } from '@likehoney/ui'

import type { LabLang } from './lab-copy'
import { AdminLab } from './admin-lab'
import { StorefrontLab } from './storefront-lab'

export type LabView = 'storefront' | 'admin'

type LabDir = 'rtl' | 'ltr'

export interface LabShellProps {
  view: LabView
}

export function LabShell({ view }: LabShellProps) {
  const [lang, setLang] = useState<LabLang>('ar')
  const [dir, setDir] = useState<LabDir>('rtl')

  useEffect(() => {
    const html = document.documentElement
    html.setAttribute('lang', lang)
    html.setAttribute('dir', dir)
  }, [dir, lang])

  const toggleLanguage = () => {
    setLang(lang === 'ar' ? 'en' : 'ar')
    setDir(dir === 'rtl' ? 'ltr' : 'rtl')
  }

  const otherView: LabView = view === 'storefront' ? 'admin' : 'storefront'
  const otherHref = otherView === 'storefront' ? '/__design/storefront' : '/__design/admin'
  const theme = view === 'storefront' ? 'customer' : 'admin'

  return (
    <div className={cx(`lh-theme-${theme}`, 'lh-viewport')}>
      <nav
        aria-label="Design lab navigation"
        className="fixed inset-x-0 top-0 z-50 border-b border-border bg-surface/95 backdrop-blur-sm"
      >
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-1">
            <Link
              href="/__design/storefront"
              aria-current={view === 'storefront' ? 'page' : undefined}
              className={cx(
                'lh-focus inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-semibold transition-colors',
                view === 'storefront'
                  ? 'bg-honey-soft text-honey-deep'
                  : 'text-ink-3 hover:bg-surface-muted hover:text-ink',
              )}
            >
              <Store size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Storefront</span>
            </Link>
            <Link
              href="/__design/admin"
              aria-current={view === 'admin' ? 'page' : undefined}
              className={cx(
                'lh-focus inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-semibold transition-colors',
                view === 'admin'
                  ? 'bg-honey-soft text-honey-deep'
                  : 'text-ink-3 hover:bg-surface-muted hover:text-ink',
              )}
            >
              <LayoutDashboard size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Admin</span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-ink-3 md:inline">
              Internal design lab — معاينة داخلية
            </span>
            <IconButton
              variant="plain"
              label={lang === 'ar' ? 'Switch to English (LTR)' : 'التبديل إلى العربية (RTL)'}
              onClick={toggleLanguage}
            >
              <Languages size={18} aria-hidden="true" />
            </IconButton>
            <Link
              href={otherHref}
              className="lh-focus inline-flex h-9 items-center rounded-full border border-border-strong px-3 text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-muted hover:text-ink"
            >
              {otherView === 'storefront' ? 'Storefront →' : 'Admin →'}
            </Link>
          </div>
        </div>
      </nav>

      <div className="pt-20">
        {view === 'storefront' ? <StorefrontLab lang={lang} /> : <AdminLab lang={lang} />}
      </div>
    </div>
  )
}
