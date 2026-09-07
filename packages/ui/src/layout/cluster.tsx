import type { HTMLAttributes } from 'react'

import { cx } from '../lib/cx'
import {
  alignValue,
  justifyValue,
  spaceVar,
  type Align,
  type Justify,
  type SpaceToken,
  type StyleWithVar,
} from '../lib/tokens'

type ClusterStyle = StyleWithVar<'--lh-cluster-gap' | '--lh-cluster-align' | '--lh-cluster-justify'>

export interface ClusterProps extends HTMLAttributes<HTMLDivElement> {
  gap?: SpaceToken
  align?: Align
  justify?: Justify
}

export function Cluster({
  gap = 3,
  align = 'center',
  justify = 'start',
  style,
  className,
  ...props
}: ClusterProps) {
  const clusterStyle: ClusterStyle = {
    '--lh-cluster-gap': spaceVar(gap),
    '--lh-cluster-align': alignValue(align),
    '--lh-cluster-justify': justifyValue(justify),
    ...style,
  }

  return <div className={cx('lh-cluster', className)} style={clusterStyle} {...props} />
}
