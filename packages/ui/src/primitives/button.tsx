import type { ButtonHTMLAttributes } from 'react'

import { cx } from '../lib/cx'
import { Spinner } from './spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'ghost' | 'danger'

export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  loading?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'lh-button',
        `lh-button--${variant}`,
        `lh-button--${size}`,
        block && 'lh-button--block',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner aria-hidden="true" /> : null}
      {children}
    </button>
  )
}
