import type { HTMLAttributes, ReactNode } from 'react'

import { cx } from '../lib/cx'
import { spaceVar, type SpaceToken, type StyleWithVar } from '../lib/tokens'

type DividerStyle = StyleWithVar<'--lh-divider-margin'>

export interface DividerProps extends HTMLAttributes<HTMLHRElement> {
  label?: ReactNode
  margin?: SpaceToken
}

export function Divider({ label, margin, style, className, ...props }: DividerProps) {
  const dividerStyle: DividerStyle = {
    ...(margin !== undefined ? { '--lh-divider-margin': spaceVar(margin) } : null),
    ...style,
  }

  if (label) {
    return (
      <div className={cx('lh-divider--label', className)} style={dividerStyle} {...props}>
        {label}
      </div>
    )
  }

  return <hr className={cx('lh-divider', className)} style={dividerStyle} {...props} />
}
