import type { InputHTMLAttributes, ReactNode } from 'react'

import { cx } from '../lib/cx'

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
}

export function Switch({ label, disabled, className, ...props }: SwitchProps) {
  return (
    <label className={cx('lh-switch', disabled && 'lh-switch--disabled', className)}>
      <input
        type="checkbox"
        role="switch"
        className="lh-switch__input"
        disabled={disabled}
        {...props}
      />
      <span className="lh-switch__track" aria-hidden="true">
        <span className="lh-switch__thumb" />
      </span>
      <span className="lh-switch__label">{label}</span>
    </label>
  )
}
