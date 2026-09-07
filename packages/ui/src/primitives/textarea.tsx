import type { TextareaHTMLAttributes } from 'react'

import { cx } from '../lib/cx'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export function Textarea({ invalid = false, className, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cx('lh-textarea', className)}
      {...props}
    />
  )
}
