import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'

import { cx } from '../lib/cx'

export type TableProps = HTMLAttributes<HTMLTableElement>

export function Table({ className, ...props }: TableProps) {
  return <table className={cx('lh-table', className)} {...props} />
}

export type TableHeadProps = HTMLAttributes<HTMLTableSectionElement>

export function THead({ className, ...props }: TableHeadProps) {
  return <thead className={cx('lh-table__head', className)} {...props} />
}

export type TableBodyProps = HTMLAttributes<HTMLTableSectionElement>

export function TBody({ className, ...props }: TableBodyProps) {
  return <tbody className={cx('lh-table__body', className)} {...props} />
}

export type TableRowProps = HTMLAttributes<HTMLTableRowElement>

export function TR({ className, ...props }: TableRowProps) {
  return <tr className={cx('lh-table__row', className)} {...props} />
}

export type TableHeadCellProps = ThHTMLAttributes<HTMLTableCellElement>

export function TH({ className, ...props }: TableHeadCellProps) {
  return (
    <th
      scope="col"
      className={cx('lh-table__cell', 'lh-table__cell--head', className)}
      {...props}
    />
  )
}

export type TableCellProps = TdHTMLAttributes<HTMLTableCellElement>

export function TD({ className, ...props }: TableCellProps) {
  return <td className={cx('lh-table__cell', className)} {...props} />
}
