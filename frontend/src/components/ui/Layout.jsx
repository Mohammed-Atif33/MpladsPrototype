import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { AlertTriangle, Inbox, Loader2, Info, CheckCircle2 } from 'lucide-react'

export function Card({ children, className, pad = true, ...rest }) {
  return <div className={clsx('card', pad && 'card-pad', className)} {...rest}>{children}</div>
}

export function CardHeader({ title, subtitle, actions, icon: Icon }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="flex items-start gap-2">
        {Icon && <Icon className="mt-0.5 h-5 w-5 text-navy-600" />}
        <div>
          <h3 className="leading-tight">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        {back && <Link to={back.to} className="text-xs text-navy-600 hover:underline">← {back.label}</Link>}
        <h1>{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

const TONES = {
  blue: 'bg-blue-50 text-blue-700', green: 'bg-green-50 text-green-700', yellow: 'bg-yellow-50 text-yellow-700',
  orange: 'bg-orange-50 text-orange-700', red: 'bg-red-50 text-red-700', slate: 'bg-slate-100 text-slate-600',
  purple: 'bg-purple-50 text-purple-700',
}

export function KpiCard({ label, value, icon: Icon, tone = 'blue', hint, to }) {
  const inner = (
    <div className={clsx('card card-pad flex items-center gap-4 h-full', to && 'transition hover:border-navy-300 hover:shadow-md')}>
      {Icon && <div className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', TONES[tone])}><Icon className="h-5 w-5" /></div>}
      <div className="min-w-0">
        <div className="text-2xl font-semibold leading-none text-slate-900">{value ?? '—'}</div>
        <div className="mt-1 text-xs font-medium text-slate-500 leading-snug">{label}</div>
        {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
      </div>
    </div>
  )
  return to ? <Link to={to} className="block">{inner}</Link> : inner
}

export function Spinner({ label = 'Loading…', className }) {
  return (
    <div className={clsx('flex items-center justify-center gap-2 py-10 text-sm text-slate-500', className)}>
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  )
}

export function ErrorBanner({ error, onRetry, className }) {
  if (!error) return null
  const msg = typeof error === 'string' ? error : error.message
  return (
    <div className={clsx('flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800', className)} role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{msg}</div>
      {onRetry && <button className="text-xs font-medium underline" onClick={onRetry}>Retry</button>}
    </div>
  )
}

export function Notice({ tone = 'blue', children, className }) {
  const t = { blue: 'border-blue-200 bg-blue-50 text-blue-800', yellow: 'border-yellow-200 bg-yellow-50 text-yellow-900',
    orange: 'border-orange-200 bg-orange-50 text-orange-900', green: 'border-green-200 bg-green-50 text-green-800', red: 'border-red-200 bg-red-50 text-red-800' }
  const Icon = tone === 'green' ? CheckCircle2 : tone === 'blue' ? Info : AlertTriangle
  return (
    <div className={clsx('flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm', t[tone], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" /><div className="flex-1">{children}</div>
    </div>
  )
}

export function EmptyState({ title = 'Nothing here yet', hint, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Icon className="h-8 w-8 text-slate-300" />
      <div className="text-sm font-medium text-slate-600">{title}</div>
      {hint && <div className="max-w-md text-xs text-slate-400">{hint}</div>}
      {action}
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="border-b border-slate-200">
      <nav className="-mb-px flex gap-1 overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
            className={clsx('whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition',
              value === t.key ? 'border-navy-700 text-navy-800' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
          </button>
        ))}
      </nav>
    </div>
  )
}

export function useTabs(initial) {
  const [tab, setTab] = useState(initial)
  return [tab, setTab]
}

/** Progress bar with optional planned marker. */
export function ProgressBar({ value = 0, planned, className, tone }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  const behind = planned !== undefined && planned !== null && planned - v > 15
  const colour = tone || (behind ? 'bg-orange-500' : 'bg-navy-600')
  return (
    <div className={clsx('w-full', className)}>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className={clsx('h-full rounded-full', colour)} style={{ width: `${v}%` }} />
        {planned !== undefined && planned !== null && (
          <div className="absolute top-0 h-full w-0.5 bg-slate-700" style={{ left: `${Math.min(100, planned)}%` }} title={`Planned ${planned}%`} />
        )}
      </div>
    </div>
  )
}

export function Stat({ label, value, sub, className }) {
  return (
    <div className={className}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-900">{value ?? '—'}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  )
}

export function KeyValue({ items, cols = 2 }) {
  return (
    <dl className={clsx('grid gap-x-6 gap-y-3', cols === 3 ? 'sm:grid-cols-3' : cols === 1 ? '' : 'sm:grid-cols-2')}>
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-sm text-slate-900 break-words">{v ?? '—'}</dd></div>
      ))}
    </dl>
  )
}
