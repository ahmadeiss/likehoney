'use client'

import { CreditCard, MessageSquareText, Store, Truck } from 'lucide-react'
import { useState } from 'react'

import { Button, Dialog, Field, Input, Switch } from '@likehoney/ui'
import { STORE_SETTING_DEFS, type StoreSettingKey } from '@likehoney/shared'

import { ApiError, client, type DeliveryZoneDoc, type SettingDoc } from '../../../lib/admin/client'
import { useLocale, useT, type DictKey } from '../../../lib/admin/i18n'
import { useMutation, useResource } from '../../../lib/admin/hooks'
import {
  AdminEmpty,
  AdminPage,
  Chip,
  ErrorState,
  errorMessage,
  Flash,
  MoneyInput,
  PageHeader,
  Panel,
  PanelHead,
  RowSkeleton,
  StatusBadge,
} from '../_components/shared'

type Tab = 'store' | 'delivery' | 'payment' | 'content'

const TABS: { key: Tab; labelKey: DictKey; icon: typeof Store }[] = [
  { key: 'store', labelKey: 'settings.tab.store', icon: Store },
  { key: 'delivery', labelKey: 'settings.tab.delivery', icon: Truck },
  { key: 'payment', labelKey: 'settings.tab.payment', icon: CreditCard },
  { key: 'content', labelKey: 'settings.tab.content', icon: MessageSquareText },
]

function summaryText(key: StoreSettingKey, locale: 'ar' | 'en'): string {
  const def = STORE_SETTING_DEFS[key]
  return locale === 'ar' ? def.summaryAr : def.summaryEn
}

export default function AdminSettingsPage() {
  const t = useT()
  const [tab, setTab] = useState<Tab>('store')
  const settings = useResource(() => client.listSettings(), [])
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const save = async (key: string, value: unknown) => {
    setMessage(null)
    try {
      await client.setSetting(key, { value })
      setMessage({ tone: 'ok', text: t('settings.settingSaved') })
      settings.reload()
    } catch {
      setMessage({ tone: 'error', text: t('error.generic') })
    }
  }

  const list = settings.data ?? null

  return (
    <AdminPage>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />

      <div className="lh-admin-hub">
        <nav className="lh-admin-hub-nav" aria-label={t('settings.title')}>
          {TABS.map(({ key, labelKey, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={`lh-admin-hub-tab${tab === key ? ' lh-admin-hub-tab--active' : ''}`}
              aria-current={tab === key ? 'page' : undefined}
              onClick={() => setTab(key)}
            >
              <Icon size={15} aria-hidden="true" />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        <div className="lh-admin-hub-panels">
          {message ? <Flash tone={message.tone}>{message.text}</Flash> : null}

          {settings.loading && !list ? (
            <Panel>
              <RowSkeleton rows={3} />
            </Panel>
          ) : settings.error ? (
            <ErrorState error={settings.error} onRetry={settings.reload} />
          ) : list === null ? null : tab === 'store' ? (
            <Panel>
              <PanelHead title={t('settings.tab.store')} sub={t('settings.storeHint')} />
              <div className="mt-4">
                <CurrencyReadout settings={list} />
              </div>
            </Panel>
          ) : tab === 'payment' ? (
            <PaymentMethodsPanel />
          ) : tab === 'content' ? (
            <Panel>
              <PanelHead title={t('settings.tab.content')} sub={t('settings.contentHint')} />
              <div className="mt-4">
                <AnnouncementField settings={list} onSaved={(v) => save(v.key, v.value)} />
              </div>
            </Panel>
          ) : (
            <DeliveryZonesPanel />
          )}
        </div>
      </div>
    </AdminPage>
  )
}

// ---------------------------------------------------------------------------
// Store fields
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Payment methods (Gate B4 Stage 5) — "طرق الدفع"
// ---------------------------------------------------------------------------

type PaymentField = 'codEnabled' | 'electronicEnabled'

function PaymentMethodsPanel() {
  const t = useT()
  const settings = useResource(() => client.getPaymentSettings(), [])
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [pendingField, setPendingField] = useState<PaymentField | null>(null)

  const toggle = async (field: PaymentField, next: boolean) => {
    setMessage(null)
    setPendingField(field)
    try {
      await client.updatePaymentSettings({ [field]: next })
      setMessage({ tone: 'ok', text: t('payments.savedToast') })
      settings.reload()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'no_payment_method_enabled') {
        setMessage({
          tone: 'error',
          text: t(
            field === 'codEnabled'
              ? 'payments.codDisableBlocked'
              : 'payments.electronicDisableBlocked',
          ),
        })
      } else {
        setMessage({ tone: 'error', text: errorMessage(error, t) })
      }
    } finally {
      setPendingField(null)
    }
  }

  const data = settings.data

  return (
    <div className="flex flex-col gap-4">
      {message ? <Flash tone={message.tone}>{message.text}</Flash> : null}

      <Panel>
        <PanelHead title={t('payments.methodsTitle')} sub={t('settings.paymentHint')} />
        {settings.loading && !data ? (
          <div className="mt-4">
            <RowSkeleton rows={2} />
          </div>
        ) : settings.error ? (
          <div className="mt-4">
            <ErrorState error={settings.error} onRetry={settings.reload} />
          </div>
        ) : data ? (
          <div className="mt-4 flex flex-col gap-3">
            <PaymentMethodRow
              titleKey="payments.codTitle"
              hintKey="payments.codHint"
              enabled={data.cod.enabled}
              available={data.cod.available}
              pending={pendingField === 'codEnabled'}
              disabled={pendingField !== null}
              onToggle={(next) => void toggle('codEnabled', next)}
            />
            <PaymentMethodRow
              titleKey="payments.electronicTitle"
              hintKey="payments.electronicHint"
              enabled={data.electronic.enabled}
              available={data.electronic.available}
              pending={pendingField === 'electronicEnabled'}
              disabled={pendingField !== null}
              onToggle={(next) => void toggle('electronicEnabled', next)}
              blockers={data.electronic.blockers}
            />
          </div>
        ) : null}
      </Panel>

      {data ? (
        <Panel>
          <PanelHead title={t('payments.reconcileTitle')} />
          <div className="mt-3 flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-ink">{t('payments.reconcileLabel')}</span>
              <span className="text-base font-bold tabular-nums text-ink" dir="ltr">
                {t('payments.reconcileMinutes', { n: data.reservationReconcileAfterMinutes })}
              </span>
            </div>
            <p className="text-xs text-ink-3">{t('payments.reconcileHint')}</p>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}

function PaymentMethodRow({
  titleKey,
  hintKey,
  enabled,
  available,
  pending,
  disabled,
  onToggle,
  blockers,
}: {
  titleKey: DictKey
  hintKey: DictKey
  enabled: boolean
  available: boolean
  pending: boolean
  disabled: boolean
  onToggle: (next: boolean) => void
  blockers?: string[]
}) {
  const t = useT()
  return (
    <div
      className="lh-admin-record"
      style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.6rem' }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink">{t(titleKey)}</p>
          <p className="text-xs text-ink-3">{t(hintKey)}</p>
        </div>
        <Switch
          checked={enabled}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
          label={
            pending ? t('common.saving') : enabled ? t('common.enabled') : t('common.disabled')
          }
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink-4">{t('payments.availability')}:</span>
        <Chip tone={available ? 'done' : 'pending'}>
          {available ? t('payments.available') : t('payments.unavailable')}
        </Chip>
      </div>
      {!available && blockers && blockers.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {blockers.map((code) => (
            <li key={code} className="text-xs font-medium text-warning">
              {BLOCKER_DICT_KEY[code] ? t(BLOCKER_DICT_KEY[code]) : code}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

const BLOCKER_DICT_KEY: Record<string, DictKey> = {
  payment_provider_not_configured: 'payments.blocker.payment_provider_not_configured',
  payment_provider_not_allowed: 'payments.blocker.payment_provider_not_allowed',
  payment_provider_unavailable: 'payments.blocker.payment_provider_unavailable',
  payment_infrastructure_not_ready: 'payments.blocker.payment_infrastructure_not_ready',
}

function AnnouncementField({
  settings,
  onSaved,
}: {
  settings: SettingDoc[]
  onSaved: (saved: { key: string; value: unknown }) => void
}) {
  const t = useT()
  const key = 'store:announcement'
  const doc = settings.find((s) => s.key === key)
  const raw =
    doc?.value && typeof doc.value === 'object' && 'ar' in doc.value
      ? (doc.value as { ar: string; en: string })
      : { ar: '', en: '' }
  const [ar, setAr] = useState(raw.ar)
  const [en, setEn] = useState(raw.en)

  return (
    <div className="flex flex-col gap-3">
      <Field label={t('settings.announcementAr')}>
        <Input value={ar} onChange={(e) => setAr(e.target.value)} />
      </Field>
      <Field label={t('settings.announcementEn')}>
        <Input dir="ltr" value={en} onChange={(e) => setEn(e.target.value)} />
      </Field>
      <div>
        <Button size="sm" onClick={() => onSaved({ key, value: { ar, en } })}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}

function CurrencyReadout({ settings }: { settings: SettingDoc[] }) {
  const t = useT()
  const locale = useLocale()
  const doc = settings.find((s) => s.key === 'general:currency')
  const value =
    doc?.value && typeof doc.value === 'object' && 'code' in doc.value
      ? (doc.value as { code: string }).code
      : 'ILS'
  return (
    <Field
      label={t('settings.currency')}
      hint={value === 'ILS' ? t('settings.currencyIls') : summaryText('general:currency', locale)}
    >
      <Input value={value} readOnly dir="ltr" />
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Delivery zones
// ---------------------------------------------------------------------------

function DeliveryZonesPanel() {
  const t = useT()
  const locale = useLocale()
  const { data, error, loading, reload } = useResource(
    () => client.listDeliveryZones({ pageSize: 100 }),
    [],
  )
  const [confirmDelete, setConfirmDelete] = useState<DeliveryZoneDoc | null>(null)
  const [editor, setEditor] = useState<{
    mode: 'create' | 'edit'
    zone: DeliveryZoneDoc | null
  } | null>(null)
  const { run, pending } = useMutation((id: string) => client.removeDeliveryZone(id))
  const zones = data?.data ?? []

  const remove = async (zone: DeliveryZoneDoc) => {
    const result = await run(zone.id)
    if (result.ok) {
      setConfirmDelete(null)
      reload()
    }
  }

  return (
    <Panel flush>
      <PanelHead
        title={t('settings.deliveryZones')}
        sub={t('settings.deliveryZonesHint')}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEditor({ mode: 'create', zone: null })}
          >
            {t('settings.newZone')}
          </Button>
        }
      />

      {loading ? (
        <RowSkeleton rows={3} />
      ) : error ? (
        <div className="p-5">
          <ErrorState error={error} onRetry={reload} />
        </div>
      ) : zones.length === 0 ? (
        <AdminEmpty
          icon={<Truck size={22} aria-hidden="true" />}
          title={t('settings.zoneEmpty')}
          text={t('settings.zoneEmptyHint')}
          action={
            <Button size="sm" onClick={() => setEditor({ mode: 'create', zone: null })}>
              {t('settings.newZone')}
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="lh-admin-table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th className="lh-admin-td-num">{t('settings.zoneFee')}</th>
                <th>{t('common.status')}</th>
                <th aria-label={t('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => (
                <tr key={zone.id}>
                  <td>
                    <div className="lh-admin-cell-title">
                      {locale === 'ar' ? zone.nameAr : zone.nameEn}
                    </div>
                    <div className="lh-admin-cell-sub font-mono">{zone.code}</div>
                  </td>
                  <td className="lh-admin-td-num text-ink-2">
                    {formatMinor(zone.feeMinor, locale)}
                  </td>
                  <td>
                    <StatusBadge value={zone.isActive ? 'active' : 'inactive'} />
                  </td>
                  <td className="text-end">
                    <div className="lh-admin-inline-actions justify-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditor({ mode: 'edit', zone })}
                      >
                        {t('common.edit')}
                      </Button>
                      {confirmDelete?.id === zone.id ? (
                        <>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={pending}
                            onClick={() => void remove(zone)}
                          >
                            {t('common.confirm')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                            {t('common.cancel')}
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(zone)}>
                          {t('common.delete')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor !== null ? (
        <ZoneEditorDialog
          mode={editor.mode}
          zone={editor.zone}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            reload()
          }}
        />
      ) : null}
    </Panel>
  )
}

function formatMinor(minor: number, locale: 'ar' | 'en'): string {
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-PS-u-nu-latn' : 'en-IL', {
      style: 'currency',
      currency: 'ILS',
      currencyDisplay: 'narrowSymbol',
    }).format(minor / 100)
  } catch {
    return `${(minor / 100).toFixed(2)} ILS`
  }
}

function ZoneEditorDialog({
  mode,
  zone,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  zone: DeliveryZoneDoc | null
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const [code, setCode] = useState(zone?.code ?? '')
  const [nameAr, setNameAr] = useState(zone?.nameAr ?? '')
  const [nameEn, setNameEn] = useState(zone?.nameEn ?? '')
  const [feeMinor, setFeeMinor] = useState(zone?.feeMinor ?? 0)
  const [isActive, setIsActive] = useState(zone?.isActive ?? true)
  const [displayOrder, setDisplayOrder] = useState(zone?.displayOrder ?? 0)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const { run, pending } = useMutation(() =>
    mode === 'create'
      ? client.createDeliveryZone({
          code: code.trim().toUpperCase(),
          nameAr: nameAr.trim(),
          nameEn: nameEn.trim(),
          feeMinor,
          isActive,
          displayOrder,
        })
      : client.updateDeliveryZone(zone!.id, {
          code: code.trim().toUpperCase(),
          nameAr: nameAr.trim(),
          nameEn: nameEn.trim(),
          feeMinor,
          isActive,
          displayOrder,
        }),
  )

  const submit = async () => {
    if (code.trim().length === 0 || nameAr.trim().length === 0 || nameEn.trim().length === 0) {
      setFieldError(t('error.invalid'))
      return
    }
    const result = await run()
    if (result.ok) onSaved()
    else setFieldError(t('error.generic'))
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === 'create' ? t('settings.newZone') : t('settings.editZone')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('settings.zoneNameAr')}>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </Field>
          <Field label={t('settings.zoneNameEn')}>
            <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('settings.zoneCode')}>
            <Input
              dir="ltr"
              className="font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
            />
          </Field>
          <Field label={t('settings.zoneFee')}>
            <MoneyInput valueMinor={feeMinor} onChangeMinor={setFeeMinor} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('settings.zoneOrder')}>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={String(displayOrder)}
              onChange={(e) => setDisplayOrder(Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
            />
          </Field>
          <Field label={t('settings.zoneActive')}>
            <Switch
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              label={isActive ? t('common.enabled') : t('common.disabled')}
            />
          </Field>
        </div>

        {fieldError ? (
          <p className="text-sm font-medium text-danger" role="alert">
            {fieldError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={pending}>
            {mode === 'create' ? t('common.create') : t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
