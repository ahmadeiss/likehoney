'use client'

import { useState } from 'react'

import { Button, Field, Textarea } from '@likehoney/ui'

import { ApiError, client, type AdminOrderCommandResult } from '../../../../lib/admin/client'
import { useMutation } from '../../../../lib/admin/hooks'
import { useT } from '../../../../lib/admin/i18n'
import { errorMessage } from '../../_components/shared'
import { Sheet } from './sheet'

type Mode = 'processing' | 'delivering'
type RestockChoice = 'yes' | 'no' | null

/**
 * Cancellation flow for a COD, unpaid order — one deliberate screen.
 *
 *  - `processing` → reason only; stock is always restored (stated up front).
 *  - `delivering` → reason + an explicit, un-defaulted "did the goods physically
 *    come back?" decision presented as two choice cards. The server never infers.
 *
 * Race handled: if another employee starts delivery while this is open, a
 * `processing`-style submit returns `restock_decision_required`; we re-fetch,
 * switch to the `delivering` decision and make the employee answer it.
 */
export function CancelOrderDialog({
  order,
  onClose,
  onCancelled,
  onConflict,
}: {
  order: { id: string; number: string; status: string }
  onClose: () => void
  onCancelled: (result: AdminOrderCommandResult, restocked: boolean) => void
  onConflict: () => void
}) {
  const t = useT()
  const cancel = useMutation(client.cancelOrder)

  const [mode, setMode] = useState<Mode>(
    order.status === 'delivering' ? 'delivering' : 'processing',
  )
  const [reason, setReason] = useState('')
  const [restock, setRestock] = useState<RestockChoice>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [movedNote, setMovedNote] = useState(false)
  const [showReasonError, setShowReasonError] = useState(false)

  const trimmedReason = reason.trim()
  const reasonValid = trimmedReason.length >= 3
  const canConfirm = reasonValid && (mode === 'processing' || restock !== null)
  const resultRestocked = mode === 'processing' ? true : restock === 'yes'

  async function submit() {
    if (!canConfirm) {
      setShowReasonError(true)
      return
    }
    setConflict(null)
    const input =
      mode === 'processing'
        ? { reason: trimmedReason }
        : { reason: trimmedReason, restockReturnedItems: restock === 'yes' }
    const res = await cancel.run(order.id, input)

    if (res.ok) {
      onCancelled(res.data, resultRestocked)
      return
    }

    const code = res.error instanceof ApiError ? res.error.code : 'unknown_error'
    if (code === 'restock_decision_required') {
      try {
        const fresh = await client.getOrder(order.id)
        if (fresh.fulfillment.status === 'delivering') {
          setMode('delivering')
          setRestock(null)
          setMovedNote(true)
          return
        }
      } catch {
        /* fall through */
      }
      setConflict(t('orders.cancel.nowDelivering'))
      return
    }
    setConflict(errorMessage(res.error, t))
  }

  const footer = conflict ? (
    <Button
      variant="secondary"
      onClick={() => {
        onConflict()
        onClose()
      }}
    >
      {t('common.done')}
    </Button>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose} disabled={cancel.pending}>
        {t('orders.cancel.dismiss')}
      </Button>
      <Button variant="danger" loading={cancel.pending} disabled={!canConfirm} onClick={submit}>
        {t('orders.cancel.confirm')}
      </Button>
    </>
  )

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('orders.cancel.title', { number: order.number })}
      closeLabel={t('common.close')}
      footer={footer}
    >
      {conflict ? (
        <p className="text-sm leading-relaxed text-ink-2" dir="auto">
          {conflict}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {movedNote ? (
            <p
              className="rounded-md bg-warning-soft px-3 py-2.5 text-xs font-medium leading-relaxed text-warning"
              dir="auto"
            >
              {t('orders.cancel.nowDelivering')}
            </p>
          ) : null}

          {mode === 'processing' ? (
            <p className="text-sm leading-relaxed text-ink-2" dir="auto">
              {t('orders.cancel.processingNote')}
            </p>
          ) : null}

          <Field
            label={t('orders.cancel.reasonLabel')}
            required
            error={showReasonError && !reasonValid ? t('orders.cancel.reasonRequired') : undefined}
          >
            <Textarea
              rows={4}
              value={reason}
              placeholder={t('orders.cancel.reasonPlaceholder')}
              invalid={showReasonError && !reasonValid}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          {mode === 'delivering' ? (
            <fieldset className="flex flex-col gap-2.5">
              <legend className="mb-1 text-sm font-semibold text-ink" dir="auto">
                {t('orders.cancel.deliveringQuestion')}
              </legend>
              <label className="lh-choice">
                <input
                  type="radio"
                  name="restock"
                  checked={restock === 'yes'}
                  onChange={() => setRestock('yes')}
                />
                <span className="lh-choice__mark" aria-hidden="true" />
                <span>
                  <span className="lh-choice__title">{t('orders.cancel.returnedYes')}</span>
                  <span className="lh-choice__hint">{t('orders.cancel.yesNote')}</span>
                </span>
              </label>
              <label className="lh-choice">
                <input
                  type="radio"
                  name="restock"
                  checked={restock === 'no'}
                  onChange={() => setRestock('no')}
                />
                <span className="lh-choice__mark" aria-hidden="true" />
                <span>
                  <span className="lh-choice__title">{t('orders.cancel.returnedNo')}</span>
                  <span className="lh-choice__hint">{t('orders.cancel.noNote')}</span>
                </span>
              </label>
            </fieldset>
          ) : null}
        </div>
      )}
    </Sheet>
  )
}
