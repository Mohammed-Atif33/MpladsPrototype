import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Briefcase, CalendarClock, Play, RotateCcw, Scale, ScrollText, ShieldAlert, TrendingUp, Zap } from 'lucide-react'
import { api } from '../../lib/api'
import { RISK_COLOURS } from '../../lib/nav'
import {
  Card, CardHeader, EmptyState, ErrorBanner, Field, Input, KpiCard, Notice, PageHeader, Spinner, useApi, useToast,
} from '../../components/ui'
import { RiskDonut } from '../../components/officer/common'

const CHECK_ROWS = [
  ['overdue_inspections', 'Overdue inspections'], ['unresolved_cases', 'Unresolved cases'], ['overdue_followups', 'Overdue follow-ups'],
  ['stale_complaints', 'Complaints awaiting screening'], ['repeated_patterns', 'Repeated risk patterns'], ['notifications_created', 'Notifications created'],
]

export default function HeadDashboard() {
  const toast = useToast()
  const { data, loading, error, reload } = useApi(() => api.get('/api/dashboard'), [])
  const [asOf, setAsOf] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [runErr, setRunErr] = useState(null)

  const runChecks = async () => {
    setRunning(true); setRunErr(null)
    try {
      const res = await api.post('/api/system/run-checks', asOf ? { as_of: asOf } : {})
      setResult(res)
      toast(`Supervisory checks complete (as of ${res.as_of}): ${res.notifications_created} notification(s) created.`)
      reload()
    } catch (e) { setRunErr(e) } finally { setRunning(false) }
  }

  if (loading && !data) return <Spinner />
  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />
  const k = data.kpis
  const a = data.audit_summary || {}

  return (
    <>
      <PageHeader title="Supervisory Dashboard" subtitle="Escalated cases, high-risk supervision, inspections, appeals and audit overview" />
      <ErrorBanner error={error} onRetry={reload} className="mb-4" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Escalated Projects" value={k.escalated} icon={ShieldAlert} tone="red" to="/head/cases" />
        <KpiCard label="High-Risk Cases" value={k.high_risk} icon={AlertTriangle} tone="orange" to="/head/cases?tab=high" />
        <KpiCard label="Critical Cases" value={k.critical_risk} icon={ShieldAlert} tone="red" to="/head/cases?tab=critical" />
        <KpiCard label="Pending Supervision" value={k.pending_supervision} icon={CalendarClock} tone="yellow" hint="escalated, not yet acknowledged" to="/head/cases" />
        <KpiCard label="Inspection Issues" value={k.inspection_issues} icon={Briefcase} tone="orange" hint={`${k.overdue_inspections} overdue · ${k.awaiting_assignment} awaiting assignment`} to="/head/inspections" />
        <KpiCard label="Appeals" value={k.appeals} icon={Scale} tone="purple" hint="citizen appeals pending" to="/head/complaints" />
        <KpiCard label="Reopened Cases" value={k.reopened} icon={RotateCcw} tone="blue" to="/head/projects?status=Reopened" />
        <KpiCard label="Audit Events (7 days)" value={a.total_7d} icon={ScrollText} tone="slate" hint={`${a.decisions ?? 0} decisions · ${a.corrections ?? 0} corrections · ${a.escalations ?? 0} escalations`} to="/head/audit" />
      </div>

      <Card className="mt-5 border-navy-200 bg-navy-50/40">
        <CardHeader title="Run scheduled supervisory checks" icon={Zap}
          subtitle="Flags overdue inspections, unresolved cases, overdue follow-ups, complaints awaiting screening and repeated agency risk patterns. These checks also run automatically in the background." />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Simulate date (optional)" hint="Pick a future date to demonstrate overdue / unresolved alerts."><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="!w-48" /></Field>
          <button className="btn-primary mb-5" onClick={runChecks} disabled={running}><Play className="h-4 w-4" /> {running ? 'Running checks…' : 'Run checks now'}</button>
        </div>
        <ErrorBanner error={runErr} className="mt-1" />
        {result && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 text-sm font-medium text-slate-700">Result (as of {result.as_of})</div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {CHECK_ROWS.map(([key, label]) => (
                <div key={key} className="rounded-md bg-slate-50 p-2.5 text-center"><div className="text-xl font-semibold text-slate-900">{result[key]}</div><div className="text-[11px] leading-tight text-slate-500">{label}</div></div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Checks are idempotent: running them again for the same date does not create duplicate notifications.</p>
          </div>
        )}
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Risk distribution" subtitle="Latest analysis of live projects" />
          <RiskDonut data={data.risk_distribution} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Risk trend" icon={TrendingUp} subtitle="Analyses per day by level (last 30 days)" />
          {(data.risk_trend || []).length === 0 ? <EmptyState title="No analyses in the last 30 days" /> : (
            <div className="h-64"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.risk_trend}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} /><Tooltip /><Legend />
                {['Low', 'Medium', 'High', 'Critical'].map((l) => <Bar key={l} dataKey={l} stackId="r" fill={RISK_COLOURS[l]} />)}</BarChart>
            </ResponsiveContainer></div>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Agencies with most High / Critical projects" />
          {(data.agency_high_risk || []).length === 0 ? <EmptyState title="No high-risk agency patterns" /> : (
            <div className="h-64"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.agency_high_risk} layout="vertical" margin={{ left: 10 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="agency" width={170} tick={{ fontSize: 11 }} /><Tooltip />
                <Bar dataKey="count" name="High/Critical projects" fill={RISK_COLOURS.High} radius={[0, 4, 4, 0]} /></BarChart>
            </ResponsiveContainer></div>
          )}
        </Card>
        <Card>
          <CardHeader title="Audit summary" subtitle="Last 7 days" actions={<Link to="/head/audit" className="text-sm text-navy-700 hover:underline">Full audit & trends →</Link>} />
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
            {[['Total events', a.total_7d], ['Risk analyses', a.risk_analyses], ['Decisions', a.decisions], ['Data corrections', a.corrections], ['Escalations', a.escalations], ['Head actions', a.head_actions]].map(([l, v]) => (
              <div key={l} className="rounded-md bg-slate-50 p-3"><div className="text-2xl font-semibold">{v ?? 0}</div><div className="text-xs text-slate-500">{l}</div></div>
            ))}
          </div>
        </Card>
      </div>

      <Notice tone="yellow" className="mt-5">Prototype risk thresholds - not official government thresholds. Risk scores are prioritisation signals, not proof of wrongdoing.</Notice>
    </>
  )
}
