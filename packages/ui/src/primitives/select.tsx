import type { SelectHTMLAttributes } from 'react'

import { cx } from '../lib/cx'

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  invalid?: boolean
  size?: 'md' | 'lg'
}

export function Select({
  invalid = false,
  size = 'md',
  className,
  children,
  ...props
}: SelectProps) {
  return (
    <span
      className={cx(
        'lh-select',
        size === 'lg' && 'lh-select--lg',
        invalid && 'lh-select--invalid',
        className,
      )}
    >
      <select className="lh-select__control" aria-invalid={invalid || undefined} {...props}>
        {children}
      </select>
    </span>
  )
}
