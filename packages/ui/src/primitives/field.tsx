'use client'

import { cloneElement, isValidElement, useId, type ReactNode } from 'react'
import { Input } from './input'
import { Select } from './select'
import { Textarea } from './textarea'

interface ControlProps {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling'
  'aria-required'?: boolean | 'true' | 'false'
}

export interface FieldProps {
  label?: string
  htmlFor?: string
  required?: boolean
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
}

export function Field({ label, htmlFor, required = false, hint, error, children }: FieldProps) {
  const generatedId = useId()
  const isControl =
    isValidElement<ControlProps>(children) &&
    (children.type === Input ||
      children.type === Select ||
      children.type === Textarea ||
      children.type === 'input' ||
      children.type === 'select' ||
      children.type === 'textarea')
  const controlId = htmlFor ?? (isControl ? (children.props.id ?? generatedId) : undefined)
  const descriptionId = `${generatedId}-description`
  const control = isControl
    ? cloneElement(children, {
        id: controlId,
        'aria-describedby':
          [children.props['aria-describedby'], error || hint ? descriptionId : undefined]
            .filter(Boolean)
            .join(' ') || undefined,
        ...(error ? { 'aria-invalid': true as const } : {}),
        'aria-required': required || children.props['aria-required'],
      })
    : children
  return (
    <div className="lh-field">
      {label ? (
        <label className="lh-field__label" htmlFor={controlId}>
          {label}
          {required ? (
            <span aria-hidden="true" className="lh-field__required">
              {' '}
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {control}
      {error ? (
        <div className="lh-field__error" role="alert" id={descriptionId}>
          {error}
        </div>
      ) : hint ? (
        <div className="lh-field__hint" id={descriptionId}>
          {hint}
        </div>
      ) : null}
    </div>
  )
}
