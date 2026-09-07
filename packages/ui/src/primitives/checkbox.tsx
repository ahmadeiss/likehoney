import { Check } from 'lucide-react'
import type { InputHTMLAttributes, ReactNode } from 'react'

import { cx } from '../lib/cx'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
}

export function Checkbox({ label, disabled, className, ...props }: CheckboxProps) {
  return (
    <label className={cx('lh-checkbox', disabled && 'lh-checkbox--disabled', className)}>
      <input type="checkbox" className="lh-checkbox__input" disabled={disabled} {...props} />
      <span className="lh-checkbox__box" aria-hidden="true">
        <Check strokeWidth={3} />
      </span>
      <span className="lh-checkbox__label">{label}</span>
    </label>
  )
}
