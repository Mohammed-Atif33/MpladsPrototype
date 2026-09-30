import clsx from 'clsx'
import { NOTIF_STYLES } from '../../lib/nav'

const RISK = {
  Low: 'bg-green-100 text-green-800 ring-1 ring-green-200',
  Medium: 'bg-yellow-100 text-yellow-800 ring-1 ring-yellow-300',
  High: 'bg-orange-100 text-orange-800 ring-1 ring-orange-300',
  Critical: 'bg-red-100 text-red-800 ring-1 ring-red-300',
}
export const RISK_DOT = { Low: 'bg-green-500', Medium: 'bg-yellow-400', High: 'bg-orange-500', Critical: 'bg-red-600' }

/** Risk badge: Green=Low, Yellow=Medium, Orange=High, Red=Critical. */
export function RiskBadge({ level, score, className }) {
  if (!level) return <span className="pill bg-slate-100 text-slate-500">Not analysed</span>
  return (
    <span className={clsx('pill', RISK[level] || 'bg-slate-100 text-slate-600', className)}>
      <span className={clsx('h-2 w-2 rounded-full', RISK_DOT[level])} />
      {level}{score !== undefined && score !== null ? ` · ${Number(score).toFixed(0)}` : ''}
    </span>
  )
}

const STATUS_TONE = {
  // project statuses
  'Officer Review Required': 'bg-yellow-100 text-yellow-800',
  'Under Review': 'bg-yellow-100 text-yellow-800',
  'Verified - Analysis Pending': 'bg-blue-100 text-blue-800',
  'Clarification Requested': 'bg-orange-100 text-orange-800',
  'Inspection Requested': 'bg-orange-100 text-orange-800',
  'Escalated to Head Officer': 'bg-red-100 text-red-800',
  'Escalated Further': 'bg-red-200 text-red-900',
  'Supervisory Review': 'bg-purple-100 text-purple-800',
  'Evidence Requested': 'bg-orange-100 text-orange-800',
  Reopened: 'bg-red-100 text-red-800',
  'Cleared - Routine Monitoring': 'bg-green-100 text-green-800',
  Closed: 'bg-slate-200 text-slate-700',
  // public / agency
  'On track': 'bg-green-100 text-green-800',
  Delayed: 'bg-orange-100 text-orange-800',
  Completed: 'bg-blue-100 text-blue-800',
  Active: 'bg-green-100 text-green-800',
  'Clarification requested': 'bg-orange-100 text-orange-800',
  'Additional evidence requested': 'bg-orange-100 text-orange-800',
  'Inspection pending': 'bg-orange-100 text-orange-800',
  // complaints
  Submitted: 'bg-blue-100 text-blue-800',
  Assigned: 'bg-indigo-100 text-indigo-800',
  'Under Investigation': 'bg-yellow-100 text-yellow-800',
  Resolved: 'bg-green-100 text-green-800',
  Appealed: 'bg-purple-100 text-purple-800',
  Rejected: 'bg-slate-200 text-slate-700',
  Pending: 'bg-yellow-100 text-yellow-800',
  Verified: 'bg-green-100 text-green-800',
  // inspections & requests
  Requested: 'bg-blue-100 text-blue-800',
  Scheduled: 'bg-indigo-100 text-indigo-800',
  'Report Submitted': 'bg-teal-100 text-teal-800',
  'Action Pending': 'bg-orange-100 text-orange-800',
  Approved: 'bg-green-100 text-green-800',
  Open: 'bg-orange-100 text-orange-800',
  Responded: 'bg-green-100 text-green-800',
  'Pending Verification': 'bg-yellow-100 text-yellow-800',
  Discarded: 'bg-slate-200 text-slate-600',
  Disabled: 'bg-red-100 text-red-800',
}

export function StatusBadge({ status, className }) {
  if (!status) return null
  return <span className={clsx('pill', STATUS_TONE[status] || 'bg-slate-100 text-slate-700', className)}>{status}</span>
}

const CONF = {
  High: 'bg-green-100 text-green-800',
  Medium: 'bg-yellow-100 text-yellow-800',
  Low: 'bg-orange-100 text-orange-800',
  Missing: 'bg-red-100 text-red-700',
}
export function ConfidenceBadge({ level }) {
  return <span className={clsx('pill', CONF[level] || 'bg-slate-100 text-slate-600')}>{level}</span>
}

const PRIORITY = { Low: 'bg-slate-100 text-slate-700', Medium: 'bg-blue-100 text-blue-800', High: 'bg-orange-100 text-orange-800', Urgent: 'bg-red-100 text-red-800' }
export function PriorityBadge({ priority }) {
  return <span className={clsx('pill', PRIORITY[priority] || 'bg-slate-100')}>{priority}</span>
}

export function NotifDot({ priority, className }) {
  return <span className={clsx('inline-block h-2.5 w-2.5 rounded-full', (NOTIF_STYLES[priority] || NOTIF_STYLES.info).dot, className)} />
}

export function Pill({ children, tone = 'slate', className }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700', blue: 'bg-blue-100 text-blue-800', green: 'bg-green-100 text-green-800',
    yellow: 'bg-yellow-100 text-yellow-800', orange: 'bg-orange-100 text-orange-800', red: 'bg-red-100 text-red-800',
    purple: 'bg-purple-100 text-purple-800',
  }
  return <span className={clsx('pill', tones[tone], className)}>{children}</span>
}
