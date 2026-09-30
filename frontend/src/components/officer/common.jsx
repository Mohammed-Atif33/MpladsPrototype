import { useState } from 'react'
import clsx from 'clsx'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { RISK_COLOURS } from '../../lib/nav'
import { fmtDateTime } from '../../lib/format'
import { DataTable, EmptyState } from '../ui'

export const LEVELS = ['Low', 'Medium', 'High', 'Critical']

/** Compact, expandable rendering of a JSON audit value. */
export function JsonValue({ value }) {
  const [open, setOpen] = useState(false)
  if (value === null || value === undefined) return <span className="text-slate-300">—</span>
  if (typeof value !== 'object') return <span className="break-words text-xs">{String(value)}</span>
  const entries = Object.entries(value)
  const compact = entries
    .map(([k, v]) => `${k}: ${v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ')
  return (
    <button type="button" className="block max-w-xs text-left text-xs text-slate-700 hover:text-navy-700" onClick={() => setOpen((o) => !o)}>
      {open
        ? <pre className="whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(value, null, 2)}</pre>
        : <span className="line-clamp-2 break-words">{compact}</span>}
    </button>
  )
}

const ACTION_TONE = {
  Escalation: 'bg-red-100 text-red-800', 'Head Officer Action': 'bg-purple-100 text-purple-800', Decision: 'bg-blue-100 text-blue-800',
  'Risk Analysis': 'bg-orange-100 text-orange-800', 'Data Correction': 'bg-yellow-100 text-yellow-800',
  Verification: 'bg-green-100 text-green-800', 'Status Change': 'bg-slate-100 text-slate-700',
}

/** Audit rows: User | Role | Action | Entity/Project | Old value | New value | Reason | Timestamp */
export function AuditTable({ rows, empty }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.audit_id}
      empty={empty || <EmptyState title="No audit records" hint="Nothing matches the current filters." />}
      columns={[
        { key: 'timestamp', header: 'Timestamp', render: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.timestamp)}</span> },
        { key: 'user', header: 'User', render: (r) => r.user || <span className="text-slate-400">System</span> },
        { key: 'role', header: 'Role', render: (r) => <span className="text-xs">{r.role || '—'}</span> },
        { key: 'action', header: 'Action', render: (r) => <span className={clsx('pill', ACTION_TONE[r.action] || 'bg-slate-100 text-slate-700')}>{r.action}</span> },
        { key: 'entity', header: 'Entity / Project', render: (r) => <span className="text-xs">{r.entity_type || '—'} {r.entity_id || ''}{r.project_id ? <span className="text-slate-400"> · P{r.project_id}</span> : null}</span> },
        { key: 'previous_value', header: 'Old value', render: (r) => <JsonValue value={r.previous_value} /> },
        { key: 'new_value', header: 'New value', render: (r) => <JsonValue value={r.new_value} /> },
        { key: 'reason', header: 'Reason', render: (r) => <span className="line-clamp-3 max-w-xs text-xs">{r.reason || '—'}</span> },
      ]}
    />
  )
}

/** Donut of risk levels using the Green/Yellow/Orange/Red scheme. */
export function RiskDonut({ data = [] }) {
  const total = data.reduce((s, d) => s + d.count, 0)
  if (!total) return <EmptyState title="No analysed projects yet" />
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="level" innerRadius={55} outerRadius={90} paddingAngle={2}>
            {data.map((d) => <Cell key={d.level} fill={RISK_COLOURS[d.level]} />)}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

export function levelForScore(score) {
  if (score >= 80) return 'Critical'
  if (score >= 60) return 'High'
  if (score >= 30) return 'Medium'
  return 'Low'
}

export const INSPECTION_STEPS = ['Requested', 'Assigned', 'Scheduled', 'Completed', 'Report Submitted', 'Action Pending', 'Closed']

export function Stepper({ status, compact }) {
  const idx = INSPECTION_STEPS.indexOf(status)
  return (
    <ol className={clsx('flex flex-wrap items-center gap-y-1', compact ? 'gap-x-1' : 'gap-x-2')}>
      {INSPECTION_STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1">
          <span className={clsx('flex items-center justify-center rounded-full text-[10px] font-semibold',
            compact ? 'h-4 w-4' : 'h-5 w-5', i < idx ? 'bg-green-500 text-white' : i === idx ? 'bg-navy-700 text-white' : 'bg-slate-200 text-slate-500')}>{i + 1}</span>
          {!compact && <span className={clsx('text-xs', i === idx ? 'font-semibold text-slate-900' : 'text-slate-500')}>{s}</span>}
          {i < INSPECTION_STEPS.length - 1 && <span className={clsx('h-px', compact ? 'w-2' : 'w-4', i < idx ? 'bg-green-400' : 'bg-slate-200')} />}
        </li>
      ))}
    </ol>
  )
}
