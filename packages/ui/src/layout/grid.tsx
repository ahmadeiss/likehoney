import type { HTMLAttributes } from 'react'

import { cx } from '../lib/cx'
import { spaceVar, type SpaceToken, type StyleWithVar } from '../lib/tokens'

type GridStyle = StyleWithVar<'--lh-grid-gap' | '--lh-grid-cols' | '--lh-grid-min'>

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Explicit column count. Ignored when `fluid` is set.
   */
  columns?: number
  /**
   * Auto-fit columns by minimum width — responsive by construction.
   */
  fluid?: boolean
  /**
   * Minimum column width in pixels when `fluid` is set.
   */
  minWidth?: number
  gap?: SpaceToken
}

export function Grid({
  columns = 1,
  fluid = false,
  minWidth = 256,
  gap = 4,
  style,
  className,
  ...props
}: GridProps) {
  const gridStyle: GridStyle = {
    '--lh-grid-gap': spaceVar(gap),
    ...(fluid ? { '--lh-grid-min': `${minWidth}px` } : { '--lh-grid-cols': String(columns) }),
    ...style,
  }

  return (
    <div
      className={cx('lh-grid', fluid && 'lh-grid--fluid', className)}
      style={gridStyle}
      {...props}
    />
  )
}
