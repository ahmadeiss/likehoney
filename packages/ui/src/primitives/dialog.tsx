'use client'

import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

import { cx } from '../lib/cx'
import { IconButton } from './icon-button'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  closeLabel?: string
  children: ReactNode
  footer?: ReactNode
}

/**
 * Accessible modal built on the native <dialog> element (focus trapping,
 * Esc-to-close and ::backdrop are handled by the platform). Renders nothing
 * visible while closed.
 */
export function Dialog({
  open,
  onClose,
  title,
  closeLabel = 'Close',
  children,
  footer,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    const handleCancel = () => onClose()
    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [onClose])

  return (
    <dialog ref={ref} className="lh-dialog" aria-labelledby={titleId}>
      <div className="lh-dialog__header" role="presentation">
        <h2 className="lh-dialog__title" id={titleId}>
          {title}
        </h2>
        <IconButton size="sm" label={closeLabel} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
      <div className={cx('lh-dialog__body')}>{children}</div>
      {footer !== undefined ? <div className="lh-dialog__footer">{footer}</div> : null}
    </dialog>
  )
}
