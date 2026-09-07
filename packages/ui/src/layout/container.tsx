import type { HTMLAttributes } from 'react'

import { cx } from '../lib/cx'

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg'
}

export function Container({ size = 'lg', className, ...props }: ContainerProps) {
  return (
    <div
      className={cx('lh-container', size !== 'lg' && `lh-container--${size}`, className)}
      {...props}
    />
  )
}
