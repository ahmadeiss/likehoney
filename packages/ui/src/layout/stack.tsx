import type { HTMLAttributes } from 'react'

import { cx } from '../lib/cx'
import { alignValue, spaceVar, type Align, type SpaceToken, type StyleWithVar } from '../lib/tokens'

type StackStyle = StyleWithVar<'--lh-stack-gap' | '--lh-stack-align'>

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: SpaceToken
  align?: Align
}

export function Stack({ gap = 4, align = 'stretch', style, className, ...props }: StackProps) {
  const stackStyle: StackStyle = {
    '--lh-stack-gap': spaceVar(gap),
    '--lh-stack-align': alignValue(align),
    ...style,
  }

  return <div className={cx('lh-stack', className)} style={stackStyle} {...props} />
}
