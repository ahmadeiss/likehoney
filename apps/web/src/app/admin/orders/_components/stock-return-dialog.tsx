'use client'

import { useMemo, useState } from 'react'

import { Button, Input } from '@likehoney/ui'

import {
  client,
  type AdminOrderDetail,
  type AdminOrderStockReturnReceipt,
} from '../../../../lib/admin/client'
import { useMutation } from '../../../../lib/admin/hooks'
import { useLocale, useT } from '../../../../lib/admin/i18n'
import { formatCount } from '../../../../lib/admin/format'
import { errorMessage } from '../../_components/shared'
import { Sheet } from './sheet'

type EligibleLine = AdminOrderDetail['items'][number] & {
  stockReturn: NonNullable<AdminOrderDetail['items'][number]['stockReturn']>
}

/**
 * "تسجيل وصول المنتجات للمحل" — records merchandise physically received back
 * at the store after a cancelled order, days or weeks after cancellation.
 * Only ever shows lines with `remainingReturnableQuantity > 0`; a line's
 * quantity defaults to its full remaining amount and can only be reduced,
 * never exceeded. This is a physical-inventory fact only — it never touches
 * order status or payment.
 */
export function StockReturnDialog({
  order,
  onClose,
  onRecorded,
}: {
  order: AdminOrderDetail
  onClose: () => void
  onRecorded: (receipt: AdminOrderStockReturnReceipt) => void
}) {
  const t = useT()
  const locale = useLocale()
  const record = useMutation(client.recordOrderStockReturn)

  const eligible = useMemo(
    (): EligibleLine[] =>
      order.items.filter(
        (i): i is EligibleLine =>
          i.stockReturn !== null && i.stockReturn.remainingReturnableQuantity > 0,
      ),
    [order.items],
  )

  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      eligible.map((i) => [i.orderItemId, String(i.stockReturn.remainingReturnableQuantity)]),
    ),
  )
  const [idempotencyKey] = useState(() => `lh-return-${crypto.randomUUID()}`)
  const [formError, setFormError] = useState<string | null>(null)

  const setQty = (orderItemId: string, raw: string, max: number) => {
    const digitsOnly = raw.replace(/[^\d]/g, '')
    const clamped = digitsOnly === '' ? '' : String(Math.min(Number(digitsOnly), max))
    setQuantities((prev) => ({ ...prev, [orderItemId]: clamped }))
  }

  const lines = eligible
    .map((i) => ({
      orderItemId: i.orderItemId,
      quantity: Math.trunc(Number(quantities[i.orderItemId]) || 0),
    }))
    .filter((l) => l.quantity > 0)

  const submit = async () => {
    if (lines.length === 0) {
      setFormError(t('inventory.qtyMustBePositive'))
      return
    }
    setFormError(null)
    const res = await record.run(order.id, { idempotencyKey, lines })
    if (res.ok) {
      onRecorded(res.data)
      return
    }
    setFormError(errorMessage(res.error, t))
  }

  if (eligible.length === 0) {
    return (
      <Sheet
        open
        onClose={onClose}
        title={t('orders.return.dialogTitle', { number: order.number })}
        closeLabel={t('common.close')}
        footer={
          <Button variant="secondary" onClick={onClose}>
            {t('common.done')}
          </Button>
        }
      >
        <p className="text-sm leading-relaxed text-ink-2" dir="auto">
          {t('orders.return.noneEligible')}
        </p>
      </Sheet>
    )
  }

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={record.pending}>
        {t('orders.return.cancelDialog')}
      </Button>
      <Button
        variant="primary"
        loading={record.pending}
        disabled={lines.length === 0}
        onClick={submit}
      >
        {t('orders.return.confirm')}
      </Button>
    </>
  )

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('orders.return.dialogTitle', { number: order.number })}
      closeLabel={t('common.close')}
      footer={footer}
    >
      <div className="flex flex-col gap-5">
        <p
          className="rounded-md bg-warning-soft px-3 py-2.5 text-xs font-medium leading-relaxed text-warning"
          dir="auto"
        >
          {t('orders.return.dialogWarning')}
        </p>

        <ul className="flex flex-col gap-4">
          {eligible.map((item) => {
            const name = locale === 'ar' ? item.productNameAr : item.productNameEn
            const label = locale === 'ar' ? item.variantLabelAr : item.variantLabelEn
            const remaining = item.stockReturn.remainingReturnableQuantity
            return (
              <li key={item.orderItemId} className="rounded-lg border border-border p-3.5">
                <p className="text-sm font-semibold leading-snug text-ink" dir="auto">
                  {name}
                  {label ? <span className="font-normal text-ink-2"> — {label}</span> : null}
                </p>
                <p className="mt-0.5 font-mono text-[0.6875rem] text-ink-4">{item.sku}</p>

                <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="lh-text-caption text-ink-4">{t('orders.return.lineOrdered')}</p>
                    <p className="font-semibold tabular-nums text-ink">
                      {formatCount(item.stockReturn.originalDeductedQuantity, locale)}
                    </p>
                  </div>
                  <div>
                    <p className="lh-text-caption text-ink-4">{t('orders.return.lineReturned')}</p>
                    <p className="font-semibold tabular-nums text-ink">
                      {formatCount(item.stockReturn.alreadyReturnedQuantity, locale)}
                    </p>
                  </div>
                  <div>
                    <p className="lh-text-caption text-ink-4">{t('orders.return.lineRemaining')}</p>
                    <p className="font-semibold tabular-nums text-ink">
                      {formatCount(remaining, locale)}
                    </p>
                  </div>
                </div>

                <label className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-ink-2" dir="auto">
                    {t('orders.return.lineReceivingNow')}
                  </span>
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    className="w-20 text-center tabular-nums"
                    value={quantities[item.orderItemId] ?? ''}
                    onChange={(e) => setQty(item.orderItemId, e.target.value, remaining)}
                  />
                </label>
              </li>
            )
          })}
        </ul>

        {formError ? (
          <p className="text-sm font-medium text-danger" role="alert">
            {formError}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
