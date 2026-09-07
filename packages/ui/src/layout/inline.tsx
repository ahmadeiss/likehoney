import type { HTMLAttributes } from 'react'

import { cx } from '../lib/cx'
import { alignValue, spaceVar, type Align, type SpaceToken, type StyleWithVar } from '../lib/tokens'

type InlineStyle = StyleWithVar<'--lh-inline-gap' | '--lh-inline-align' | '--lh-inline-wrap'>

export interface InlineProps extends HTMLAttributes<HTMLDivElement> {
  gap?: SpaceToken
  align?: Align
  wrap?: boolean
}

export function Inline({
  gap = 3,
  align = 'center',
  wrap = false,
  style,
  className,
  ...props
}: InlineProps) {
  const inlineStyle: InlineStyle = {
    '--lh-inline-gap': spaceVar(gap),
    '--lh-inline-align': alignValue(align),
    '--lh-inline-wrap': wrap ? 'wrap' : 'nowrap',
    ...style,
  }

  return <div className={cx('lh-inline', className)} style={inlineStyle} {...props} />
}
