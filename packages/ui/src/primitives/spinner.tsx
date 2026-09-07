import type { HTMLAttributes } from 'react'

import { cx } from '../lib/cx'

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: 'sm' | 'md' | 'lg'
}

export function Spinner({ size = 'md', className, ...props }: SpinnerProps) {
  return (
    <span
      role="status"
      className={cx('lh-spinner', size === 'lg' && 'lh-spinner--lg', className)}
      {...props}
    />
  )
}
