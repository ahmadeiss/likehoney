export type SpaceToken = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

export function spaceVar(token: SpaceToken): string {
  return `var(--lh-space-${token})`
}

export type Align = 'start' | 'center' | 'end' | 'stretch'

export function alignValue(align: Align): string {
  switch (align) {
    case 'start':
      return 'flex-start'
    case 'end':
      return 'flex-end'
    case 'center':
      return 'center'
    case 'stretch':
      return 'stretch'
  }
}

export type Justify = 'start' | 'center' | 'end' | 'between'

export function justifyValue(justify: Justify): string {
  switch (justify) {
    case 'start':
      return 'flex-start'
    case 'end':
      return 'flex-end'
    case 'center':
      return 'center'
    case 'between':
      return 'space-between'
  }
}

export type StyleWithVar<T extends string> = React.CSSProperties &
  Partial<Record<T, string | number | undefined>>
