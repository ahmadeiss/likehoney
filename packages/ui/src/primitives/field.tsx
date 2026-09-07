import type { ReactNode } from 'react'

export interface FieldProps {
  label?: string
  htmlFor?: string
  required?: boolean
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
}

export function Field({ label, htmlFor, required = false, hint, error, children }: FieldProps) {
  return (
    <div className="lh-field">
      {label ? (
        <label className="lh-field__label" htmlFor={htmlFor}>
          {label}
          {required ? (
            <span aria-hidden="true" className="lh-field__required">
              {' '}
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <div className="lh-field__error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="lh-field__hint">{hint}</div>
      ) : null}
    </div>
  )
}
