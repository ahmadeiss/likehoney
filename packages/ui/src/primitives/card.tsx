import type { HTMLAttributes } from 'react'

import { cx } from '../lib/cx'
import { spaceVar, type SpaceToken, type StyleWithVar } from '../lib/tokens'

type CardStyle = StyleWithVar<'--lh-card-pad'>

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
  accent?: boolean
  flush?: boolean
  pad?: SpaceToken
}

export function Card({
  interactive = false,
  accent = false,
  flush = false,
  pad,
  style,
  className,
  ...props
}: CardProps) {
  const cardStyle: CardStyle = {
    ...(pad !== undefined ? { '--lh-card-pad': spaceVar(pad) } : null),
    ...style,
  }

  return (
    <div
      className={cx(
        'lh-card',
        flush && 'lh-card--flush',
        interactive && 'lh-card--interactive',
        accent && 'lh-card--accent',
        className,
      )}
      style={cardStyle}
      {...props}
    />
  )
}
