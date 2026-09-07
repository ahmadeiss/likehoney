'use client'

import { KeyRound, UserRound, Wand2 } from 'lucide-react'
import { useId, useState } from 'react'

import { Button, Dialog, Field, Input, Select, Spinner } from '@likehoney/ui'

import { client, type DevStaffOption } from '../../../lib/admin/client'
import { useResource } from '../../../lib/admin/hooks'
import { useIdentity } from '../../../lib/admin/identity'
import { useT } from '../../../lib/admin/i18n'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

function identityLabel(staff: DevStaffOption | undefined): string {
  if (staff === undefined) return ''
  return staff.nameEn !== null && staff.nameEn.length > 0
    ? `${staff.nameAr} (${staff.nameEn})`
    : staff.nameAr
}

function compactIdentityName(staff: DevStaffOption | undefined, id: string): string {
  if (staff !== undefined) return staff.nameAr
  // `staffId` is always a validated UUID (never free-text), so a UUID prefix is
  // a safe fallback; arbitrary typed names can never reach this display value.
  return id.slice(0, 8)
}

export function IdentityControl() {
  const t = useT()
  const { staffId, hasIdentity, setStaffId } = useIdentity()
  const [open, setOpen] = useState(false)

  // Primary source of identity options: the DEV-ONLY staff bootstrap endpoint,
  // which returns real active staff (id + names) without requiring staff:write,
  // so it works from a fresh browser (no identity yet). Falls back to the
  // privileged staff list when the current identity holds staff:write.
  const {
    data: staffOptions,
    loading,
    error,
  } = useResource<DevStaffOption[]>(
    () =>
      client
        .listDevStaffOptions()
        .catch(() => client.listStaff({ pageSize: 100, status: 'active' }).then((p) => p.data)),
    [staffId],
  )

  const current = staffOptions?.find((staff) => staff.id === staffId)

  // ---------- Identity editor (dialog) ----------
  const [selection, setSelection] = useState('')
  const [manual, setManual] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)
  const fieldId = useId()

  const openEditor = () => {
    setSelection(staffId ?? '')
    setManual('')
    setManualError(null)
    setShowManual(false)
    setOpen(true)
  }

  const applySelection = () => {
    setStaffId(selection.length > 0 ? selection : null)
    setOpen(false)
  }

  const applyManual = () => {
    const id = manual.trim()
    if (id.length === 0) return
    // A staff identity is its real UUID only. Free-text names must never be
    // accepted as an identity — validate the UUID format before applying.
    if (!isUuid(id)) {
      setManualError(t('shell.identity.uuidInvalid'))
      return
    }
    setManualError(null)
    setStaffId(id)
    setOpen(false)
  }

  const showOptions = error === null && staffOptions !== null && staffOptions.length > 0

  return (
    <>
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="lh-text-caption flex items-center gap-1.5 text-ink-3">
            <Wand2 size={12} aria-hidden="true" />
            {t('shell.identity.dev')}
          </span>
          <span className="truncate text-sm font-semibold text-ink">
            {!hasIdentity ? t('shell.identity.none') : compactIdentityName(current, staffId ?? '')}
          </span>
        </div>
        <Button variant="subtle" size="sm" onClick={openEditor}>
          {t('shell.identity.switch')}
        </Button>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('shell.identity.select')}
        closeLabel={t('common.close')}
      >
        <div className="flex flex-col gap-4">
          {loading ? (
            <span className="lh-text-caption inline-flex items-center gap-2">
              <Spinner size="sm" /> {t('shell.identity.loading')}
            </span>
          ) : showOptions ? (
            <Field label={t('shell.identity.current')} htmlFor={fieldId}>
              <Select
                id={fieldId}
                value={selection}
                onChange={(event) => setSelection(event.target.value)}
              >
                <option value="">{t('shell.identity.none')}</option>
                {staffOptions.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {identityLabel(staff)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="rounded border border-border px-3 py-2 text-sm text-ink-2">
              <span className="lh-text-caption inline-flex items-center gap-1.5">
                <KeyRound size={13} aria-hidden="true" />
                {t('shell.identity.optionsUnavailable')}
              </span>
              <span className="mt-2 block lh-text-caption text-ink-3">
                {t('shell.identity.manualHint')}
              </span>
            </p>
          )}

          <div className="rounded-md border border-dashed border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="lh-text-caption font-medium text-ink-2">
                {t('shell.identity.advanced')}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowManual((value) => !value)}
                aria-expanded={showManual}
              >
                {showManual ? t('common.hide') : t('common.show')}
              </Button>
            </div>
            {showManual ? (
              <>
                <div className="mt-3 flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Field label={t('shell.identity.manual')} htmlFor={`${fieldId}-manual`}>
                      <Input
                        id={`${fieldId}-manual`}
                        dir="ltr"
                        placeholder={t('shell.identity.paste')}
                        value={manual}
                        aria-invalid={manualError !== null}
                        onChange={(event) => {
                          setManual(event.target.value)
                          if (manualError !== null) setManualError(null)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') applyManual()
                        }}
                      />
                    </Field>
                  </div>
                  <Button variant="secondary" onClick={applyManual}>
                    {t('shell.identity.apply')}
                  </Button>
                </div>
                {manualError !== null ? (
                  <p className="mt-2 lh-text-caption text-danger" role="alert">
                    {manualError}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={applySelection}
              disabled={!showOptions || loading}
              aria-disabled={!showOptions || loading}
            >
              <UserRound size={14} aria-hidden="true" />
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
