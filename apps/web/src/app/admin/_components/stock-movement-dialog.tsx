'use client'

import { useState } from 'react'

import { Button, Dialog, Field, Input, Select } from '@likehoney/ui'
import { MANUAL_MOVEMENT_TYPES } from '@likehoney/shared'

import { client } from '../../../lib/admin/client'
import { useMutation } from '../../../lib/admin/hooks'
import { useLocale, useT } from '../../../lib/admin/i18n'
import { errorMessage } from './shared'
import { formatCount } from '../../../lib/admin/format'

export interface StockVariantOption {
  variantId: string
  sku: string
  label: string
  quantityOnHand: number
}

export type MovementMode = 'add' | 'subtract'

type ManualReasonKey = 'arrived' | 'correction' | 'damaged' | 'other'

/** Domain-authoritative manual movement types (see shared `MANUAL_MOVEMENT_TYPES`). */
type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number]

/**
 * Maps the operator-facing action + human reason to the authoritative manual
 * movement type. Every returned value is a member of `MANUAL_MOVEMENT_TYPES`,
 * verified by the compiler — no casts, no widening of the shared enum.
 */
function movementTypeFor(mode: MovementMode, reasonKey: ManualReasonKey): ManualMovementType {
  if (mode === 'add') return 'RESTOCK'
  return reasonKey === 'damaged' ? 'DAMAGE' : 'MANUAL_ADJUSTMENT'
}

function presetReason(key: ManualReasonKey): string | null {
  switch (key) {
    case 'arrived':
      return 'وصلت بضاعة جديدة'
    case 'correction':
      return 'تصحيح كمية'
    case 'damaged':
      return 'تلف / فقدان'
    default:
      return null
  }
}

export function StockMovementDialog({
  variantOptions,
  defaultVariantId,
  defaultMode = 'add',
  catalogsUnavailable = false,
  onClose,
  onSaved,
}: {
  variantOptions: StockVariantOption[]
  defaultVariantId?: string
  defaultMode?: MovementMode
  catalogsUnavailable?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const initialVariantId = defaultVariantId ?? variantOptions[0]?.variantId ?? ''
  const [variantId, setVariantId] = useState(initialVariantId)
  const [mode, setMode] = useState<MovementMode>(defaultMode)
  const [reasonKey, setReasonKey] = useState<ManualReasonKey>(
    defaultMode === 'add' ? 'arrived' : 'damaged',
  )
  const [quantity, setQuantity] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const single = variantOptions.length === 1 ? variantOptions[0] : undefined
  const currentQty = catalogsUnavailable
    ? 0
    : (single?.quantityOnHand ??
      variantOptions.find((option) => option.variantId === variantId)?.quantityOnHand ??
      0)

  const numeric = Math.trunc(Number(quantity) || 0)
  const sign = mode === 'add' ? 1 : -1
  const previewTotal = Math.max(0, currentQty + sign * numeric)

  const { run, pending } = useMutation(() =>
    client.recordMovement({
      variantId,
      movementType: movementTypeFor(mode, reasonKey),
      quantityChange: sign * numeric,
      reason: presetReason(reasonKey) || undefined,
    }),
  )

  const submit = async () => {
    if (variantId.length === 0) {
      setFieldError(t('error.invalid'))
      return
    }
    if (numeric <= 0) {
      setFieldError(t('inventory.qtyMustBePositive'))
      return
    }
    if (mode === 'subtract' && numeric > currentQty) {
      setFieldError(t('error.insufficientStock'))
      return
    }
    const result = await run()
    if (result.ok) {
      onSaved()
    } else {
      setFieldError(errorMessage(result.error, t))
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('inventory.newMovement')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button
            variant={mode === 'add' ? 'primary' : 'ghost'}
            onClick={() => {
              setMode('add')
              setReasonKey('arrived')
            }}
          >
            {t('inventory.addQuantity')}
          </Button>
          <Button
            variant={mode === 'subtract' ? 'primary' : 'ghost'}
            onClick={() => {
              setMode('subtract')
              setReasonKey('damaged')
            }}
          >
            {t('inventory.decreaseQuantity')}
          </Button>
        </div>

        {catalogsUnavailable ? (
          <Field label={t('inventory.manualVariantId')}>
            <Input
              dir="ltr"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value.trim())}
              placeholder="xxxxxxxx-…"
            />
          </Field>
        ) : single ? (
          <p className="rounded-lg bg-surface px-3 py-2 text-sm">
            <span className="lh-text-caption text-ink-3">{t('products.detail.optionValue')}: </span>
            <span className="font-medium text-ink">{single.label}</span>
            <span className="ms-2 font-mono text-xs text-ink-3">{single.sku}</span>
          </p>
        ) : (
          <Field label={t('products.detail.optionValue')}>
            <Select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              {variantOptions.map((option) => (
                <option key={option.variantId} value={option.variantId}>
                  {option.sku} · {option.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t('inventory.reason')}>
          <Select
            value={reasonKey}
            onChange={(e) => setReasonKey(e.target.value as ManualReasonKey)}
          >
            {mode === 'add' ? (
              <>
                <option value="arrived">{t('inventory.reasonArrived')}</option>
                <option value="other">{t('inventory.reasonOther')}</option>
              </>
            ) : (
              <>
                <option value="damaged">{t('inventory.reasonDamaged')}</option>
                <option value="correction">{t('inventory.reasonCorrection')}</option>
                <option value="other">{t('inventory.reasonOther')}</option>
              </>
            )}
          </Select>
        </Field>
        <Field
          label={
            mode === 'add' ? t('inventory.addAmountLabel') : t('inventory.decreaseAmountLabel')
          }
        >
          <Input
            dir="ltr"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="0"
          />
        </Field>

        {!catalogsUnavailable ? (
          <div className="rounded bg-surface px-3 py-2 text-sm">
            <p className="flex items-center justify-between">
              <span className="lh-text-caption text-ink-3">{t('inventory.currentQtyLabel')}</span>
              <span className="font-semibold tabular-nums text-ink">
                {formatCount(currentQty, locale)}
              </span>
            </p>
            <p className="flex items-center justify-between">
              <span className="lh-text-caption text-ink-3">
                {mode === 'add'
                  ? t('inventory.addAmountLabel')
                  : t('inventory.decreaseAmountLabel')}
              </span>
              <span className="font-semibold tabular-nums text-ink">
                {formatCount(numeric, locale)}
              </span>
            </p>
            <p className="flex items-center justify-between border-t border-border pt-1">
              <span className="lh-text-caption text-ink-3">{t('inventory.newQtyLabel')}</span>
              <span className="font-bold tabular-nums text-ink">
                {formatCount(previewTotal, locale)}
              </span>
            </p>
          </div>
        ) : null}

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
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
