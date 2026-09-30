import clsx from 'clsx'
import { EmptyState } from './Layout'

/** columns: [{ key, header, render?(row), className?, align? }] */
export function DataTable({ columns, rows, onRowClick, empty, rowKey, dense, className }) {
  if (!rows || rows.length === 0) return empty || <EmptyState />
  return (
    <div className={clsx('overflow-x-auto rounded-lg border border-slate-200 bg-white', className)}>
      <table className="min-w-full divide-y divide-slate-200">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={clsx('th', c.align === 'right' && 'text-right')}>{c.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r) : r.id ?? i}
              className={clsx(onRowClick && 'cursor-pointer hover:bg-navy-50/60', r._highlight && 'bg-yellow-50')}
              onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={clsx('td', dense && 'py-1.5', c.align === 'right' && 'text-right', c.className)}>
                  {c.render ? c.render(r) : r[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
