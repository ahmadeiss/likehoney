'use client'

import {
  Bell,
  ChevronRight,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  MoreHorizontal,
  Package,
  PackageSearch,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
} from 'lucide-react'
import Image from 'next/image'
import { useState } from 'react'

import {
  Badge,
  Button,
  Card,
  Checkbox,
  Cluster,
  Divider,
  EmptyState,
  Grid,
  IconButton,
  Input,
  Skeleton,
  Spinner,
  Stack,
  Switch,
} from '@likehoney/ui'
import { cx } from '@likehoney/ui'

import { labCopy, type LabLang } from './lab-copy'

interface AdminLabProps {
  lang: LabLang
}

const t = labCopy.admin
const pick = (value: { ar: string; en: string }, lang: LabLang) =>
  lang === 'ar' ? value.ar : value.en

type StatusKey = 'new' | 'preparing' | 'shipped' | 'complete' | 'refunded'

const statusMeta: Record<
  StatusKey,
  { key: keyof typeof t; tone: 'honey' | 'warning' | 'info' | 'success' | 'danger' }
> = {
  new: { key: 'statusNew', tone: 'honey' },
  preparing: { key: 'statusPreparing', tone: 'warning' },
  shipped: { key: 'statusShipped', tone: 'info' },
  complete: { key: 'statusComplete', tone: 'success' },
  refunded: { key: 'statusRefunded', tone: 'danger' },
}

const orders: Array<{
  id: string
  customer: { ar: string; en: string }
  items: number
  total: string
  status: StatusKey
  time: { ar: string; en: string }
}> = [
  {
    id: '#LH-1042',
    customer: { ar: 'سعاد جبر · نابلس', en: 'Suad Jabr · Nablus' },
    items: 3,
    total: '₪245',
    status: 'new',
    time: { ar: 'قبل ١٢ دقيقة', en: '12 min ago' },
  },
  {
    id: '#LH-1041',
    customer: { ar: 'لينة حداد · رام الله', en: 'Lina Haddad · Ramallah' },
    items: 1,
    total: '₪120',
    status: 'preparing',
    time: { ar: 'قبل ساعة', en: '1 hour ago' },
  },
  {
    id: '#LH-1040',
    customer: { ar: 'ماهر عوض · الخليل', en: 'Maher Awad · Hebron' },
    items: 2,
    total: '₪175',
    status: 'shipped',
    time: { ar: 'قبل ٣ ساعات', en: '3 hours ago' },
  },
  {
    id: '#LH-1039',
    customer: { ar: 'فرح النتشة · بيت لحم', en: 'Farah Natsheh · Bethlehem' },
    items: 5,
    total: '₪430',
    status: 'complete',
    time: { ar: 'أمس', en: 'Yesterday' },
  },
  {
    id: '#LH-1038',
    customer: { ar: 'رامي شاهين · جنين', en: 'Rami Shahin · Jenin' },
    items: 1,
    total: '₪95',
    status: 'refunded',
    time: { ar: 'أمس', en: 'Yesterday' },
  },
]

const stock: Array<{
  name: { ar: string; en: string }
  sku: string
  qty: number
  tone: 'success' | 'warning' | 'danger'
}> = [
  {
    name: { ar: 'حقيبة مدرسية وردية', en: 'Pink school backpack' },
    sku: 'BAG-214',
    qty: 8,
    tone: 'warning',
  },
  {
    name: { ar: 'حذاء رياضي للأطفال', en: 'Kids’ sports sneakers' },
    sku: 'SHO-350',
    qty: 120,
    tone: 'success',
  },
  {
    name: { ar: 'لعبة تعليمية خشبية', en: 'Wooden learning toy' },
    sku: 'TOY-118',
    qty: 3,
    tone: 'danger',
  },
  {
    name: { ar: 'طقم رضّع قطني', en: 'Baby essentials set' },
    sku: 'BAB-042',
    qty: 46,
    tone: 'success',
  },
]

const kpis: Array<{
  key: keyof typeof t
  value: string
  delta: string
  tone: 'success' | 'warning' | 'danger'
  icon: typeof ShoppingCart
}> = [
  { key: 'today', value: '23', delta: '+12%', tone: 'success', icon: ShoppingCart },
  { key: 'revenue', value: '₪3,240', delta: '+8%', tone: 'success', icon: Wallet },
  { key: 'lowStock', value: '5', delta: '−2', tone: 'warning', icon: Package },
  { key: 'openTickets', value: '3', delta: '+1', tone: 'danger', icon: MessageSquare },
]

const navItems: Array<{ key: keyof typeof t; icon: typeof LayoutDashboard }> = [
  { key: 'navDashboard', icon: LayoutDashboard },
  { key: 'navOrders', icon: ShoppingCart },
  { key: 'navProducts', icon: Package },
  { key: 'navStock', icon: Inbox },
  { key: 'navCustomers', icon: Users },
  { key: 'navSettings', icon: Settings },
]

export function AdminLab({ lang }: AdminLabProps) {
  const [activeNav, setActiveNav] = useState<number>(0)
  const [searching, setSearching] = useState(false)

  const simulateSearch = () => {
    if (searching) return
    setSearching(true)
    window.setTimeout(() => setSearching(false), 1600)
  }

  return (
    <div className="flex flex-col gap-6 px-4 sm:px-6 lg:flex-row lg:px-8">
      {/* ---- sidebar (desktop) ---- */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 flex h-[calc(100svh-6rem)] w-64 flex-col gap-6">
          <div className="flex items-center gap-3 px-2">
            <Image
              src="/brand/logo/like-honey-brand.png"
              alt="Like Honey"
              width={1536}
              height={1024}
              className="h-9 w-auto rounded-md object-contain"
            />
            <span className="lh-text-label">الأرشيف</span>
          </div>

          <Stack gap={2} className="flex-1">
            {navItems.map((item, index) => {
              const Icon = item.icon
              const active = index === activeNav
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveNav(index)}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'lh-focus flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                    active
                      ? 'bg-honey-soft text-honey-deep'
                      : 'text-ink-3 hover:bg-surface-muted hover:text-ink',
                  )}
                >
                  <Icon size={17} aria-hidden="true" />
                  {pick(t[item.key], lang)}
                </button>
              )
            })}
          </Stack>

          <Card pad={3} accent>
            <Stack gap={2}>
              <div className="lh-text-label">نظام الدفع</div>
              <div className="lh-text-caption">
                V1 — الدفع عند الاستلام (COD). البوابات الإلكترونية خارج النطاق حتى موافقة منفصلة.
              </div>
              <Badge tone="outline" className="self-start" dot>
                Cash on delivery
              </Badge>
            </Stack>
          </Card>
        </div>
      </aside>

      {/* ---- mobile nav ---- */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
        {navItems.map((item, index) => {
          const Icon = item.icon
          const active = index === activeNav
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveNav(index)}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'lh-focus inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold transition-colors',
                active
                  ? 'bg-honey-soft text-honey-deep'
                  : 'border border-border text-ink-3 hover:text-ink',
              )}
            >
              <Icon size={16} aria-hidden="true" />
              {pick(t[item.key], lang)}
            </button>
          )
        })}
      </div>

      {/* ---- main ---- */}
      <main className="min-w-0 flex-1 pb-16">
        <Stack gap={6}>
          {/* topbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 basis-72">
              <Input
                size="lg"
                placeholder={pick(t.search, lang)}
                aria-label={pick(t.search, lang)}
                onChange={simulateSearch}
              />
              {searching ? (
                <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-ink-4">
                  <Spinner aria-hidden="true" />
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                label={pick({ ar: 'وضع المخزون', en: 'Inventory mode' }, lang)}
                defaultChecked
              />
              <IconButton variant="plain" label="إشعارات" className="relative">
                <Bell size={18} aria-hidden="true" />
                <span
                  aria-hidden="true"
                  className="absolute end-2 top-2 h-2 w-2 rounded-full bg-honey"
                />
              </IconButton>
              <IconButton variant="plain" label="المزيد">
                <MoreHorizontal size={18} aria-hidden="true" />
              </IconButton>
            </div>
          </div>

          {/* KPIs */}
          <Grid fluid minWidth={230} gap={4}>
            {kpis.map((kpi) => {
              const Icon = kpi.icon
              return (
                <Card key={kpi.key} pad={5}>
                  <Stack gap={3}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="lh-text-label text-ink-3">{pick(t[kpi.key], lang)}</span>
                      <Icon size={17} className="text-honey-deep" aria-hidden="true" />
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="lh-text-metric">
                        <span dir="ltr">{kpi.value}</span>
                      </span>
                      <Badge tone={kpi.tone}>{kpi.delta}</Badge>
                    </div>
                  </Stack>
                </Card>
              )
            })}
          </Grid>

          {/* recent orders */}
          <Card pad={0}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div className="flex items-center gap-3">
                <h2 className="lh-text-title">{pick(t.ordersPanel, lang)}</h2>
                <Badge tone="neutral">{orders.length}</Badge>
              </div>
              <Cluster gap={2}>
                <Checkbox
                  label={pick({ ar: 'الطلبات الجديدة فقط', en: 'New only' }, lang)}
                  defaultChecked
                />
                <Button variant="ghost" size="sm" onClick={() => {}}>
                  {pick(t.clearFilters, lang)}
                </Button>
                <Button variant="subtle" size="sm">
                  {pick(t.viewAll, lang)}
                </Button>
              </Cluster>
            </div>
            <ul className="divide-y divide-border">
              {orders.map((order) => {
                const meta = statusMeta[order.status]
                return (
                  <li
                    key={order.id}
                    className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4"
                  >
                    <span className="lh-text-label w-20 shrink-0">{order.id}</span>
                    <div className="min-w-0 flex-1">
                      <div className="lh-text-label">{pick(order.customer, lang)}</div>
                      <div className="lh-text-caption">{pick(order.time, lang)}</div>
                    </div>
                    <span className="lh-text-caption hidden sm:inline">
                      {order.items} {pick(t.items, lang)}
                    </span>
                    <span className="lh-text-metric" style={{ fontSize: '1.0625rem' }}>
                      <span dir="ltr">{order.total}</span>
                    </span>
                    <Badge tone={meta.tone} dot>
                      {pick(t[meta.key], lang)}
                    </Badge>
                    <IconButton variant="default" size="sm" label={`فتح ${order.id}`}>
                      <ChevronRight size={16} className="rtl:rotate-180" aria-hidden="true" />
                    </IconButton>
                  </li>
                )
              })}
            </ul>
          </Card>

          {/* stock watch */}
          <Grid columns={2} gap={5}>
            <Card pad={5}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="lh-text-title">{pick(t.stockPanel, lang)}</h2>
                <IconButton variant="plain" size="sm" label="تحديث">
                  <Spinner aria-hidden="true" />
                </IconButton>
              </div>
              <Stack gap={4}>
                {stock.map((row) => (
                  <div key={row.sku} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="lh-text-label">{pick(row.name, lang)}</div>
                      <div className="lh-text-caption">{row.sku}</div>
                    </div>
                    <Skeleton width="24%" height="0.5rem" radius="999px" />
                    <span
                      className="lh-text-label tabular-nums"
                      style={{ width: '2.5rem', textAlign: 'end' }}
                    >
                      <span dir="ltr">{row.qty}</span>
                    </span>
                    <Badge tone={row.tone} dot>
                      {pick(
                        row.tone === 'success'
                          ? t.stockOk
                          : row.tone === 'warning'
                            ? t.stockLow
                            : t.stockCritical,
                        lang,
                      )}
                    </Badge>
                  </div>
                ))}
              </Stack>
            </Card>

            <Card pad={5}>
              <EmptyState
                icon={<PackageSearch size={28} />}
                title={pick(t.emptyTitle, lang)}
                text={pick(t.emptyText, lang)}
                action={
                  <Button variant="secondary" size="sm">
                    {pick(t.clearFilters, lang)}
                  </Button>
                }
              />
            </Card>
          </Grid>

          <Divider />

          <div className="flex items-center justify-between gap-3">
            <p className="lh-text-caption">Internal design preview — معاينة داخلية</p>
            <Switch
              label={pick({ ar: 'وضع المحاكاة', en: 'Simulation mode' }, lang)}
              defaultChecked
            />
          </div>
        </Stack>
      </main>
    </div>
  )
}
