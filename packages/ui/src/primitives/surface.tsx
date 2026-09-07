import type { HTMLAttributes } from 'react'

import { cx } from '../lib/cx'

export type SurfaceProps = HTMLAttributes<HTMLDivElement>

export function Surface({ className, ...props }: SurfaceProps) {
  return <div className={cx('lh-surface', className)} {...props} />
}
