import type { HTMLAttributes } from 'react'

import { cx } from '../lib/cx'

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  height?: string | number
  width?: string | number
  radius?: string
}

export function Skeleton({
  height = '0.875rem',
  width = '100%',
  radius,
  style,
  className,
  ...props
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx('lh-skeleton', className)}
      style={{ height, width, ...(radius ? { borderRadius: radius } : null), ...style }}
      {...props}
    />
  )
}
