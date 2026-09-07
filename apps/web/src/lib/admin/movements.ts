import type { MovementDoc } from './client'
import type { useT } from './i18n'

type Translator = ReturnType<typeof useT>

/**
 * Renders a raw ledger movement as a human-readable store event, e.g.
 * "تمت إضافة 10 قطع" / "تم خصم 2 بسبب طلب". Keeps the immutable ledger and its
 * enum values internal — operators only ever see plain store language.
 */
export function movementEventLabel(
  move: Pick<MovementDoc, 'movementType' | 'quantityChange'>,
  t: Translator,
): string {
  const qty = Math.abs(move.quantityChange)
  const params = { qty }
  const positive = move.quantityChange > 0

  switch (move.movementType) {
    case 'RESTOCK':
      return t('inventory.restockHuman', params)
    case 'ONLINE_ORDER':
      return t('inventory.orderDeductHuman', params)
    case 'ORDER_CANCELLATION_RESTORE':
      return t('inventory.orderRestoreHuman', params)
    case 'INITIAL_STOCK':
      return t('inventory.initialHuman', params)
    case 'STORE_SALE':
      return t('inventory.storeSaleHuman', params)
    case 'DAMAGE':
      return t('inventory.damageHuman', params)
    case 'RETURN':
      return t('inventory.returnHuman', params)
    case 'MANUAL_ADJUSTMENT':
      return positive ? t('inventory.restockHuman', params) : t('inventory.adjustmentHuman', params)
    default:
      return positive ? t('inventory.restockHuman', params) : t('inventory.adjustmentHuman', params)
  }
}
