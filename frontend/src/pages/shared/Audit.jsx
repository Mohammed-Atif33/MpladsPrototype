import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CheckCircle2, ChevronLeft, ChevronRight, ShieldCheck, XCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { ROLE } from '../../lib/nav'
import { Card, CardHeader, EmptyState, ErrorBanner, Field, Input, KpiCard, Notice, PageHeader, Select, Spinner, useApi } from '../../components/ui'
import { AuditTable } from '../../components/officer/common'

const PAGE = 25
const ROLES = ['Citizen', 'Implementing Agency', 'Officer', 'Head Officer', 'Admin', 'MP', 'System']

export default function Audit() {
  const { user } = useAuth()
  const isHead = user.role === ROLE.HEAD
  const [action, setAction] = useState('')
  const [role, setRole] = useState('')
  const [projectId, setProjectId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [action, role, projectId, from, to])

  const actions = useApi(() => api.get('/api/audit-logs/actions'), [])
  const projects = useApi(() => api.get('/api/projects', { page_size: 100, sort: 'name' }), [])
  const { data, loading, error, reload } = useApi(() => api.get('/api/audit-logs', {
    action, role, project_id: projectId, date_from: from, date_to: to, page, page_size: PAGE,
  }), [action, role, projectId, from, to, page])

  // Head Officer only - the summary endpoints return 403 for Officers
  const summary = useApi(() => api.get('/api/audit-logs/summary'), [], { enabled: isHead })
  const [chain, setChain] = useState(null)
  const [chainBusy, setChainBusy] = useState(false)
  const verify = async () => {
    setChainBusy(true)
    try { setChain(await api.get('/api/audit-logs/verify-chain')) } catch (e) { setChain({ error: e.message }) } finally { setChainBusy(false) }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1
  const s = summary.data

  return (
    <>
      <PageHeader title={isHead ? 'Audit & Trends' : 'Audit Trail'} subtitle="Append-only record of every important event: who did what, to which entity, old → new value, and why."
        actions={isHead && <button className="btn-secondary" onClick={verify} disabled={chainBusy}><ShieldCheck className="h-4 w-4" /> {chainBusy ? 'Verifying…' : 'Verify audit chain'}</button>} />

      {chain && (chain.error
        ? <ErrorBanner error={chain.error} className="mb-4" />
        : <Notice tone={chain.valid ? 'green' : 'red'} className="mb-4">
          <span className="inline-flex items-center gap-1.5 font-medium">{chain.valid ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            Audit chain {chain.valid ? 'Intact' : 'BROKEN'}</span>
          <span className="ml-2">{chain.checked} record(s) checked{chain.valid ? ' - no tampering detected.' : ` - first inconsistent record: #${chain.first_invalid_audit_id}.`}</span>
        </Notice>)}

      {isHead && (
        <div className="mb-5 space-y-5">
          {summary.loading && !s ? <Spinner /> : s && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="Audit records" value={s.total_records} icon={ShieldCheck} tone="purple" hint={`last ${s.window_days} days shown below`} />
                <KpiCard label="Data corrections" value={s.corrections} tone="yellow" />
                <KpiCard label="Officer decisions" value={s.decisions} tone="blue" />
                <KpiCard label="Escalations" value={s.escalations} tone="red" />
              </div>
              <div className="grid gap-5 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                  <CardHeader title="Events by action" subtitle={`last ${s.window_days} days`} />
                  <div className="h-72"><ResponsiveContainer width="100%" height="100%">
                    <BarChart data={s.by_action.slice(0, 10)} layout="vertical" margin={{ left: 10 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="action" width={120} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" fill="#3b649a" radius={[0, 4, 4, 0]} /></BarChart>
                  </ResponsiveContainer></div>
                </Card>
                <Card>
                  <CardHeader title="Events by role" />
                  <div className="h-72"><ResponsiveContainer width="100%" height="100%">
                    <BarChart data={s.by_role}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="role" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} /><YAxis allowDecimals={false} /><Tooltip />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>{s.by_role.map((r, i) => <Cell key={r.role} fill={['#3b649a', '#f97316', '#16a34a', '#a855f7', '#94a3b8'][i % 5]} />)}</Bar></BarChart>
                  </ResponsiveContainer></div>
                </Card>
                <Card>
                  <CardHeader title="Events per day" />
                  {s.by_day.length === 0 ? <EmptyState /> : <div className="h-72"><ResponsiveContainer width="100%" height="100%">
                    <BarChart data={s.by_day}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#243f65" radius={[4, 4, 0, 0]} /></BarChart>
                  </ResponsiveContainer></div>}
                </Card>
              </div>
            </>
          )}
          <ErrorBanner error={summary.error} />
        </div>
      )}

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Action"><Select value={action} onChange={(e) => setAction(e.target.value)}><option value="">All actions</option>{(actions.data || []).map((a) => <option key={a}>{a}</option>)}</Select></Field>
          <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</Select></Field>
          <Field label="Project"><Select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">All projects</option>{(projects.data?.items || []).map((p) => <option key={p.project_id} value={p.project_id}>{p.project_code}</option>)}</Select></Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {(action || role || projectId || from || to) && <button className="btn-ghost btn-sm mt-2" onClick={() => { setAction(''); setRole(''); setProjectId(''); setFrom(''); setTo('') }}>Clear filters</button>}
      </Card>

      <ErrorBanner error={error} onRetry={reload} className="mb-3" />
      <Card pad={false}>
        {loading && !data ? <Spinner /> : <AuditTable rows={data?.items || []} />}
      </Card>
      {data && data.total > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span>{data.total} record(s) · page {page} of {totalPages}</span>
          <span className="flex gap-2">
            <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /> Prev</button>
            <button className="btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight className="h-4 w-4" /></button>
          </span>
        </div>
      )}
      {!isHead && <Notice className="mt-4">Login and logout events are only visible to the Head Officer.</Notice>}
    </>
  )
}
