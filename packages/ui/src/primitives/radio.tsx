import type { InputHTMLAttributes, ReactNode } from 'react'

import { cx } from '../lib/cx'

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
}

export function Radio({ label, disabled, className, ...props }: RadioProps) {
  return (
    <label className={cx('lh-radio', disabled && 'lh-radio--disabled', className)}>
      <input type="radio" className="lh-radio__input" disabled={disabled} {...props} />
      <span className="lh-radio__circle" aria-hidden="true" />
      <span className="lh-radio__label">{label}</span>
    </label>
  )
}
