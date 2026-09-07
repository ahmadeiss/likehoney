import type { InputHTMLAttributes } from 'react'

import { cx } from '../lib/cx'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  invalid?: boolean
  size?: 'md' | 'lg'
}

export function Input({ invalid = false, size = 'md', className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cx('lh-input', size === 'lg' && 'lh-input--lg', className)}
      {...props}
    />
  )
}
