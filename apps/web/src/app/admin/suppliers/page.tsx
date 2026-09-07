'use client'

import { Truck } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { Button, Dialog, Field, Input, Select, Textarea } from '@likehoney/ui'

import {
  client,
  type EntityStatus,
  type SupplierDoc,
  type SupplierShortageDoc,
} from '../../../lib/admin/client'
import { useMutation, useResource } from '../../../lib/admin/hooks'
import { useAuth } from '../../../lib/admin/auth'
import { useLocale, useT } from '../../../lib/admin/i18n'
import { formatCount } from '../../../lib/admin/format'
import {
  AdminEmpty,
  AdminPage,
  DEFAULT_PAGE_SIZE,
  ErrorState,
  Flash,
  PageHeader,
  Pagination,
  Panel,
  RowSkeleton,
  StatusBadge,
} from '../_components/shared'

type EditorState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; supplier: SupplierDoc }

export default function AdminSuppliersPage() {
  const t = useT()
  const locale = useLocale()
  const { hasPermission } = useAuth()
  const [page, setPage] = useState(1)
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' })
  const [deleting, setDeleting] = useState<SupplierDoc | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const { data, error, loading, reload } = useResource(
    () => client.listSuppliers({ page, pageSize: DEFAULT_PAGE_SIZE }),
    [page],
  )
  const summary = useResource(
    () => (hasPermission('inventory:read') ? client.stockSummary() : Promise.resolve(null)),
    [hasPermission('inventory:read')],
  )

  const shortageBySupplier = useMemo(() => {
    const map = new Map<string, SupplierShortageDoc>()
    for (const s of summary.data?.supplierShortages ?? []) map.set(s.supplierId, s)
    return map
  }, [summary.data])

  const onSaved = useCallback(() => {
    setEditor({ mode: 'closed' })
    reload()
  }, [reload])

  const suppliers = data?.data ?? []

  return (
    <AdminPage>
      <PageHeader
        title={t('suppliers.title')}
        description={t('suppliers.description')}
        actions={
          <Button onClick={() => setEditor({ mode: 'create' })}>{t('suppliers.new')}</Button>
        }
      />

      {flash ? <Flash tone="ok">{flash}</Flash> : null}

      {deleting ? (
        <DeleteSupplierDialog
          supplier={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null)
            setFlash(t('suppliers.deleteSuccess'))
            reload()
          }}
        />
      ) : null}

      {editor.mode !== 'closed' ? (
        <SupplierEditor
          initialState={editor.mode === 'edit' ? editor.supplier : undefined}
          onSave={onSaved}
          onClose={() => setEditor({ mode: 'closed' })}
        />
      ) : null}

      {loading ? (
        <Panel flush>
          <RowSkeleton rows={4} />
        </Panel>
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : suppliers.length === 0 ? (
        <Panel>
          <AdminEmpty
            icon={<Truck size={22} aria-hidden="true" />}
            title={t('suppliers.empty')}
            text={t('suppliers.emptyHint')}
            action={
              <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
                {t('suppliers.new')}
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {suppliers.map((supplier) => (
              <li
                key={supplier.id}
                className="lh-admin-record"
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.6rem' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="lh-admin-record-title">{supplier.nameAr}</p>
                    {supplier.contactName ? (
                      <p className="text-xs text-ink-3">{supplier.contactName}</p>
                    ) : null}
                  </div>
                  <StatusBadge value={supplier.status} />
                </div>
                <SupplierHealth shortage={shortageBySupplier.get(supplier.id)} locale={locale} />
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditor({ mode: 'edit', supplier })}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(supplier)}>
                    {t('common.delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <Panel flush className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="lh-admin-table">
                <thead>
                  <tr>
                    <th>{t('suppliers.listColumn')}</th>
                    <th>{t('suppliers.contact')}</th>
                    <th>{t('suppliers.phone')}</th>
                    <th>{t('inventory.title')}</th>
                    <th>{t('common.status')}</th>
                    <th aria-label={t('common.actions')} />
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((supplier) => (
                    <tr key={supplier.id}>
                      <td>
                        <div className="lh-admin-cell-title">{supplier.nameAr}</div>
                        {supplier.nameEn ? (
                          <div className="lh-admin-cell-sub">{supplier.nameEn}</div>
                        ) : null}
                      </td>
                      <td className="text-ink-2">{supplier.contactName ?? '—'}</td>
                      <td className="text-ink-2" dir="ltr">
                        {supplier.contactPhone ?? '—'}
                      </td>
                      <td>
                        <SupplierHealth
                          shortage={shortageBySupplier.get(supplier.id)}
                          locale={locale}
                        />
                      </td>
                      <td>
                        <StatusBadge value={supplier.status} />
                      </td>
                      <td className="text-end">
                        <div className="lh-admin-inline-actions justify-end">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setEditor({ mode: 'edit', supplier })}
                          >
                            {t('common.edit')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleting(supplier)}>
                            {t('common.delete')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {data ? <Pagination meta={data.meta} onPage={setPage} /> : null}
        </>
      )}
    </AdminPage>
  )
}

function SupplierHealth({
  shortage,
  locale,
}: {
  shortage: SupplierShortageDoc | undefined
  locale: 'ar' | 'en'
}) {
  const t = useT()
  if (!shortage || (shortage.lowVariants === 0 && shortage.outVariants === 0)) {
    return <span className="lh-admin-chip lh-admin-chip--in">{t('suppliers.allGood')}</span>
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {shortage.outVariants > 0 ? (
        <span className="lh-stock-pill lh-stock-pill--out">
          {formatCount(shortage.outVariants, locale)} {t('suppliers.outWord')}
        </span>
      ) : null}
      {shortage.lowVariants > 0 ? (
        <span className="lh-stock-pill lh-stock-pill--low">
          {formatCount(shortage.lowVariants, locale)} {t('suppliers.lowWord')}
        </span>
      ) : null}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Editor / delete dialogs (unchanged logic)
// ---------------------------------------------------------------------------

function SupplierEditor({
  initialState,
  onSave,
  onClose,
}: {
  initialState?: SupplierDoc
  onSave: () => void
  onClose: () => void
}) {
  const t = useT()
  const isEdit = initialState !== undefined
  const [nameAr, setNameAr] = useState(initialState?.nameAr ?? '')
  const [nameEn, setNameEn] = useState(initialState?.nameEn ?? '')
  const [contactName, setContactName] = useState(initialState?.contactName ?? '')
  const [contactPhone, setContactPhone] = useState(initialState?.contactPhone ?? '')
  const [address, setAddress] = useState(initialState?.address ?? '')
  const [notes, setNotes] = useState(initialState?.notes ?? '')
  const [status, setStatus] = useState<EntityStatus>(initialState?.status ?? 'active')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const { run, pending } = useMutation(() =>
    isEdit
      ? client.updateSupplier(initialState.id, {
          nameAr: nameAr.trim(),
          nameEn: nameEn.trim() || null,
          contactName: contactName.trim() || null,
          contactPhone: contactPhone.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
          status,
        })
      : client.createSupplier({
          nameAr: nameAr.trim(),
          nameEn: nameEn.trim() || undefined,
          contactName: contactName.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
          status,
        }),
  )

  const submit = async () => {
    if (nameAr.trim().length === 0) {
      setFieldError(t('error.invalid'))
      return
    }
    const result = await run()
    if (result.ok) onSave()
    else setFieldError(t('error.generic'))
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? t('suppliers.edit') : t('suppliers.new')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('suppliers.nameAr')} required>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </Field>
          <Field label={t('suppliers.nameEn')}>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('suppliers.contactName')}>
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </Field>
          <Field label={t('suppliers.contactPhone')}>
            <Input
              dir="ltr"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('suppliers.address')}>
          <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label={t('suppliers.notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label={t('common.status')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as EntityStatus)}>
            <option value="active">{t('common.active')}</option>
            <option value="inactive">{t('common.inactive')}</option>
          </Select>
        </Field>

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
            {pending ? t('common.saving') : isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function DeleteSupplierDialog({
  supplier,
  onClose,
  onDeleted,
}: {
  supplier: SupplierDoc
  onClose: () => void
  onDeleted: () => void
}) {
  const t = useT()
  const [error, setError] = useState<string | null>(null)
  const { run, pending } = useMutation(() => client.removeSupplier(supplier.id))

  const confirm = async () => {
    const result = await run()
    if (result.ok) onDeleted()
    else setError(t('suppliers.confirmDelete'))
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('common.confirmDeleteTitle')}
      closeLabel={t('common.close')}
    >
      <p className="text-sm text-ink-2">{t('suppliers.confirmDelete')}</p>
      {error ? (
        <p className="mt-3 text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" loading={pending} onClick={confirm}>
          {t('common.delete')}
        </Button>
      </div>
    </Dialog>
  )
}
