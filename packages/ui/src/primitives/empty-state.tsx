import type { HTMLAttributes, ReactNode } from 'react'

import { cx } from '../lib/cx'

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode
  title: string
  text?: ReactNode
  action?: ReactNode
}

export function EmptyState({ icon, title, text, action, className, ...props }: EmptyStateProps) {
  return (
    <div className={cx('lh-empty-state', className)} {...props}>
      {icon ? (
        <div className="lh-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="lh-empty-state__title">{title}</p>
      {text ? <div className="lh-text-body">{text}</div> : null}
      {action ? <div>{action}</div> : null}
    </div>
  )
}
