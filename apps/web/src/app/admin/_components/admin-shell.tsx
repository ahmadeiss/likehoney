'use client'

import {
  ClipboardList,
  Contact,
  Hexagon,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Package,
  Receipt,
  Settings,
  Store,
  Tags,
  TrendingUp,
  Truck,
  Users,
  Warehouse,
  X,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'

import { Button, Spinner } from '@likehoney/ui'

import { useAuth, AuthProvider } from '../../../lib/admin/auth'
import { LangProvider, useLang, useT, type DictKey } from '../../../lib/admin/i18n'
import { useIdentity, IdentityProvider } from '../../../lib/admin/identity'
import { roleFromPermissions, type AdminRole } from '../../../lib/admin/role'
import { GlobalSearch } from './global-search'

type NavRole = AdminRole | 'both'

interface NavItem {
  href: string
  labelKey: DictKey
  icon: LucideIcon
  exact?: boolean
  permission?: string
  /** Which front door shows this item (default: both). */
  role?: NavRole
}

interface NavGroup {
  labelKey: DictKey
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'shell.group.home',
    items: [
      {
        href: '/admin',
        labelKey: 'shell.nav.dashboard',
        icon: LayoutDashboard,
        exact: true,
        role: 'owner',
      },
      {
        href: '/admin',
        labelKey: 'shell.nav.home',
        icon: LayoutDashboard,
        exact: true,
        role: 'employee',
      },
    ],
  },
  {
    labelKey: 'shell.group.operations',
    items: [
      {
        href: '/admin/store-sales',
        labelKey: 'shell.nav.storeSales',
        icon: Receipt,
        permission: 'store-sales:read',
      },
      {
        href: '/admin/orders',
        labelKey: 'shell.nav.orders',
        icon: ClipboardList,
        permission: 'orders:read',
      },
      {
        href: '/admin/customers',
        labelKey: 'shell.nav.customers',
        icon: Contact,
        permission: 'customers:read',
        role: 'owner',
      },
      {
        href: '/admin/reviews',
        labelKey: 'shell.nav.reviews',
        icon: MessageSquareText,
        permission: 'reviews:moderate',
        role: 'owner',
      },
    ],
  },
  {
    labelKey: 'shell.group.insights',
    items: [
      {
        href: '/admin/reports',
        labelKey: 'shell.nav.reports',
        icon: TrendingUp,
        permission: 'reports:read',
        role: 'owner',
      },
    ],
  },
  {
    labelKey: 'shell.group.catalog',
    items: [
      {
        href: '/admin/products',
        labelKey: 'shell.nav.products',
        icon: Package,
        permission: 'catalog:read',
      },
      {
        href: '/admin/inventory',
        labelKey: 'shell.nav.inventory',
        icon: Warehouse,
        permission: 'inventory:read',
      },
      {
        href: '/admin/categories',
        labelKey: 'shell.nav.categories',
        icon: Tags,
        permission: 'catalog:read',
        role: 'owner',
      },
      {
        href: '/admin/suppliers',
        labelKey: 'shell.nav.suppliers',
        icon: Truck,
        permission: 'catalog:read',
        role: 'owner',
      },
    ],
  },
  {
    labelKey: 'shell.group.management',
    items: [
      { href: '/admin/staff', labelKey: 'shell.nav.staff', icon: Users, permission: 'staff:write' },
      {
        href: '/admin/settings',
        labelKey: 'shell.nav.settings',
        icon: Settings,
        permission: 'settings:write',
      },
    ],
  },
]

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items)

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`)
}

function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '؟'
  const first = parts[0] ?? ''
  const second = parts[1] ?? ''
  if (second.length > 0) return `${first.charAt(0)}${second.charAt(0)}`
  return first.slice(0, 2)
}

// ---------------------------------------------------------------------------
// Language toggle
// ---------------------------------------------------------------------------

function LangSwitch() {
  const t = useT()
  const { lang, setLang } = useLang()
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5">
      {(['ar', 'en'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => setLang(value)}
          aria-pressed={lang === value}
          aria-label={t('shell.switchLang')}
          className={
            lang === value
              ? 'rounded bg-honey px-2 py-0.5 text-xs font-semibold text-on-honey'
              : 'rounded px-2 py-0.5 text-xs font-medium text-ink-3 hover:text-ink'
          }
        >
          {value === 'ar' ? 'ع' : 'EN'}
        </button>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Sidebar pieces
// ---------------------------------------------------------------------------

function Brand() {
  const t = useT()
  return (
    <Link
      href="/admin"
      className="lh-admin-sidebar-brand"
      aria-label={`${t('brand.name')} — ${t('brand.admin')}`}
    >
      <span className="lh-admin-sidebar-brand-icon">
        <Hexagon size={18} strokeWidth={2.2} aria-hidden="true" />
      </span>
      <span className="leading-tight">
        <span className="block text-[0.9375rem] font-bold tracking-tight text-ink">
          {t('brand.name')}
        </span>
        <span className="block text-[0.6875rem] font-medium text-ink-3">{t('brand.admin')}</span>
      </span>
    </Link>
  )
}

function Nav({
  role,
  permissions,
  onNavigate,
}: {
  role: AdminRole
  permissions: string[]
  onNavigate: () => void
}) {
  const t = useT()
  const pathname = usePathname()

  const visible = (item: NavItem): boolean => {
    if (item.role && item.role !== 'both' && item.role !== role) return false
    if (item.permission && !permissions.includes(item.permission)) return false
    return true
  }

  return (
    <div className="lh-admin-sidebar-scroll">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter(visible)
        if (items.length === 0) return null
        return (
          <nav key={group.labelKey} className="lh-admin-nav-group" aria-label={t(group.labelKey)}>
            <span className="lh-admin-nav-label">{t(group.labelKey)}</span>
            {items.map((item) => {
              const Icon = item.icon
              const active = isActive(pathname, item)
              return (
                <Link
                  key={item.labelKey}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={`lh-admin-nav-item${active ? ' lh-admin-nav-item--active' : ''}`}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{t(item.labelKey)}</span>
                </Link>
              )
            })}
          </nav>
        )
      })}
    </div>
  )
}

function SidebarFoot({ role }: { role: AdminRole }) {
  const t = useT()
  const { me, logout } = useAuth()
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    await logout()
    router.replace('/admin/login')
  }

  const name = me ? `${me.staff.nameAr}${me.staff.nameEn ? ` · ${me.staff.nameEn}` : ''}` : ''

  return (
    <div className="lh-admin-sidebar-foot">
      <div className="flex items-center justify-between gap-2 px-1">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2 hover:text-ink"
        >
          <Store size={14} aria-hidden="true" className="text-honey" />
          {t('shell.storefront')}
        </Link>
        <LangSwitch />
      </div>

      {me ? (
        <>
          <div className="lh-admin-user">
            <span className="lh-admin-user-avatar" aria-hidden="true">
              {monogram(me.staff.nameAr)}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-ink">{name}</span>
              <span
                className={`lh-admin-role-tag${role === 'owner' ? ' lh-admin-role-tag--owner' : ''}`}
              >
                {role === 'owner' ? t('shell.role.owner') : t('shell.role.employee')}
              </span>
            </div>
          </div>
          <Button
            variant="subtle"
            size="sm"
            onClick={signOut}
            disabled={signingOut}
            className="w-full"
          >
            {signingOut ? (
              <Spinner size="sm" aria-hidden="true" />
            ) : (
              <LogOut size={14} aria-hidden="true" />
            )}
            <span className="ms-1">{t('shell.logout')}</span>
          </Button>
        </>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function TopBar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const t = useT()
  const pathname = usePathname()
  const activeItem = ALL_ITEMS.find((item) => isActive(pathname, item))

  return (
    <header className="lh-admin-header lh-admin-shell">
      <div className="lh-admin-header-inner">
        <button
          type="button"
          className="lh-admin-menu-btn lh-icon-button"
          aria-label={t('shell.openMenu')}
          onClick={onOpenMobile}
        >
          <Menu size={20} aria-hidden="true" />
        </button>

        <GlobalSearch />

        <div className="lh-admin-crumb ms-auto">
          <span className="lh-admin-crumb-root">{t('brand.admin')}</span>
          <span className="lh-admin-crumb-sep" aria-hidden="true" />
          <span className="lh-admin-crumb-current">
            {activeItem ? t(activeItem.labelKey) : t('brand.admin')}
          </span>
        </div>
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const AUTH_PATHS = ['/admin/login', '/admin/change-password']

function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.includes(pathname)
}

function OperationalShell({ children }: { children: ReactNode }) {
  const t = useT()
  const { status, me } = useAuth()
  const { hasIdentity: devIdentitySelected } = useIdentity()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isDev = process.env.NODE_ENV !== 'production'
  const devFallback = isDev && devIdentitySelected

  const permissions = me?.permissions ?? []
  const role: AdminRole = roleFromPermissions(permissions)

  if (status === 'checking') {
    return (
      <div className="lh-theme-admin flex min-h-svh items-center justify-center bg-canvas">
        <div className="flex items-center gap-2 text-sm text-ink-2">
          <Spinner size="sm" aria-hidden="true" />
          {t('shell.session.checking')}
        </div>
      </div>
    )
  }

  if (status === 'authenticated' && me?.staff.mustChangePassword) {
    if (typeof window !== 'undefined') router.replace('/admin/change-password')
    return (
      <div className="lh-theme-admin flex min-h-svh items-center justify-center bg-canvas">
        <Spinner size="sm" aria-hidden="true" />
      </div>
    )
  }

  const allowed = status === 'authenticated' || (status === 'anonymous' && devFallback)
  if (!allowed) {
    if (typeof window !== 'undefined') router.replace('/admin/login')
    return (
      <div className="lh-theme-admin flex min-h-svh items-center justify-center bg-canvas">
        <Spinner size="sm" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div id="admin-root" className="flex min-h-svh">
      <aside className="lh-admin-sidebar lh-admin-shell sticky top-0 hidden h-svh w-64 shrink-0 flex-col lg:flex">
        <Brand />
        <Nav role={role} permissions={permissions} onNavigate={() => setMobileOpen(false)} />
        <SidebarFoot role={role} />
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/45 lg:hidden"
          role="presentation"
          onClick={() => setMobileOpen(false)}
        >
          <aside
            className="lh-admin-sidebar lh-admin-shell flex h-full w-[17rem] max-w-[85vw] flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label={t('shell.menu')}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border pe-2">
              <Brand />
              <button
                type="button"
                className="lh-icon-button"
                aria-label={t('shell.menu')}
                onClick={() => setMobileOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <Nav role={role} permissions={permissions} onNavigate={() => setMobileOpen(false)} />
            <SidebarFoot role={role} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMobile={() => setMobileOpen(true)} />
        <main
          id="admin-main"
          className="lh-theme-admin min-w-0 flex-1 bg-canvas px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  )
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  if (isAuthPath(pathname)) {
    return (
      <div className="lh-theme-admin min-h-svh bg-canvas">
        <div className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-6 py-10">
          {children}
        </div>
      </div>
    )
  }

  return <OperationalShell>{children}</OperationalShell>
}

export function AdminProviders({ children }: { children: ReactNode }) {
  return (
    <LangProvider>
      <AuthProvider>
        <IdentityProvider>{children}</IdentityProvider>
      </AuthProvider>
    </LangProvider>
  )
}
