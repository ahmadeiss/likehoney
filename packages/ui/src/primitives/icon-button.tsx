import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cx } from '../lib/cx'

export type IconButtonVariant = 'default' | 'soft' | 'plain'
export type IconButtonSize = 'sm' | 'md' | 'lg'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant
  size?: IconButtonSize
  /**
   * Accessible name for the control. Required.
   */
  label: string
  children: ReactNode
}

export function IconButton({
  variant = 'default',
  size = 'md',
  label,
  type = 'button',
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(
        'lh-icon-button',
        `lh-icon-button--${variant}`,
        `lh-icon-button--${size}`,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
