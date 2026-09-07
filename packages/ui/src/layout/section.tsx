import type { HTMLAttributes } from 'react'

import { cx } from '../lib/cx'

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

export function Section({ size, className, ...props }: SectionProps) {
  return (
    <section className={cx('lh-section', size && `lh-section--${size}`, className)} {...props} />
  )
}
