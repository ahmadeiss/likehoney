import type { HTMLAttributes } from 'react'

import { cx } from '../lib/cx'

export type BadgeTone = 'neutral' | 'honey' | 'success' | 'warning' | 'danger' | 'info' | 'outline'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  dot?: boolean
}

export function Badge({ tone = 'neutral', dot = false, className, ...props }: BadgeProps) {
  return (
    <span
      className={cx(
        'lh-badge',
        tone !== 'neutral' && `lh-badge--${tone}`,
        dot && 'lh-badge--dot',
        className,
      )}
      {...props}
    />
  )
}
