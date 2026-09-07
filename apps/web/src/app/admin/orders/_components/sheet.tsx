'use client'

import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * Orders-only modal surface: a bottom sheet on phones (< 40rem), a centred
 * dialog above that. Built on the native `<dialog>` element so focus trapping,
 * Esc-to-close and `::backdrop` come from the platform. The shared
 * `@likehoney/ui` `Dialog` is intentionally left untouched.
 */
export function Sheet({
  open,
  onClose,
  title,
  closeLabel = 'إغلاق',
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  closeLabel?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  }, [open])

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const onCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    el.addEventListener('cancel', onCancel)
    return () => el.removeEventListener('cancel', onCancel)
  }, [onClose])

  return (
    <dialog
      ref={ref}
      className="lh-sheet"
      aria-labelledby={titleId}
      onClick={(e) => {
        // click on the backdrop (the <dialog> itself, outside the panel) closes
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="lh-sheet__panel">
        <span className="lh-sheet__grip" aria-hidden="true" />
        <div className="lh-sheet__header">
          <h2 className="lh-sheet__title" id={titleId} dir="auto">
            {title}
          </h2>
          <button
            type="button"
            className="lh-sheet__close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="lh-sheet__body">{children}</div>
        {footer !== undefined ? <div className="lh-sheet__footer">{footer}</div> : null}
      </div>
    </dialog>
  )
}
