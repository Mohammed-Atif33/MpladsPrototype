import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ClipboardList, FileClock, FolderKanban, HelpCircle, MessageSquareWarning, TimerReset } from 'lucide-react'
import { api } from '../../lib/api'
import { Card, CardHeader, DataTable, EmptyState, ErrorBanner, KpiCard, PageHeader, ProgressBar, Spinner, StatusBadge, useApi } from '../../components/ui'

export default function AgencyDashboard() {
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi(() => api.get('/api/dashboard'), [])
  const k = data?.kpis
  const projects = data?.projects || []
  const pending = projects.filter((p) => p.report_pending)
  const delayed = data?.delayed || []
  const attention = projects.filter((p) => p.report_pending || p.delay_days > 0 || p.agency_status !== 'Active')

  return (
    <>
      <PageHeader title="Agency Dashboard" subtitle={data?.agency ? `${data.agency} - your assigned projects and pending actions` : 'Your assigned projects and pending actions'} />
      <ErrorBanner error={error} onRetry={reload} className="mb-4" />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Assigned projects" value={k?.assigned_projects} icon={FolderKanban} to="/agency/projects" />
        <KpiCard label="Pending progress reports" value={k?.pending_reports} icon={FileClock} tone="yellow" hint="no report in 30 days" to="/agency/projects" />
        <KpiCard label="Delayed projects" value={k?.delayed_projects} icon={TimerReset} tone="orange" to="/agency/projects" />
        <KpiCard label="Open complaints" value={k?.open_complaints} icon={MessageSquareWarning} tone="red" to="/agency/complaints" />
        <KpiCard label="Open clarifications" value={k?.open_clarifications} icon={HelpCircle} tone="purple" to="/agency/clarifications" />
        <KpiCard label="Pending requests" value={k?.pending_requests} icon={ClipboardList} tone="slate" to="/agency/requests" />
      </div>

      {loading && !data ? <Spinner /> : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader title="Needs your attention" icon={AlertTriangle} />
            {(k?.open_clarifications || 0) > 0 && <Link to="/agency/clarifications" className="mb-2 block rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-800 hover:bg-purple-100">{k.open_clarifications} officer clarification(s) awaiting your response →</Link>}
            {(k?.open_complaints || 0) > 0 && <Link to="/agency/complaints" className="mb-2 block rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 hover:bg-red-100">{k.open_complaints} verified complaint(s) need a response →</Link>}
            {pending.length === 0 && delayed.length === 0 && !(k?.open_clarifications || k?.open_complaints)
              ? <EmptyState title="All caught up" hint="No overdue reports, delays or open items." />
              : (
                <ul className="divide-y divide-slate-100">
                  {delayed.map((p) => (
                    <li key={`d${p.project_id}`}>
                      <Link to={`/agency/projects/${p.project_id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-slate-50">
                        <div className="min-w-0"><div className="truncate text-sm font-medium text-slate-800">{p.name}</div><div className="text-xs text-slate-400">{p.project_code}</div></div>
                        <span className="pill bg-orange-100 text-orange-800">{p.delay_days} days late</span>
                      </Link>
                    </li>
                  ))}
                  {pending.filter((p) => !delayed.some((d) => d.project_id === p.project_id)).map((p) => (
                    <li key={`r${p.project_id}`}>
                      <Link to={`/agency/projects/${p.project_id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-slate-50">
                        <div className="min-w-0"><div className="truncate text-sm font-medium text-slate-800">{p.name}</div><div className="text-xs text-slate-400">{p.project_code}</div></div>
                        <span className="pill bg-yellow-100 text-yellow-800">Report due</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
          </Card>

          <Card className="lg:col-span-2" pad={false}>
            <div className="p-4 pb-0"><CardHeader title="Your projects" subtitle="Bar marker shows the planned progress" actions={<Link to="/agency/projects" className="text-sm font-medium text-navy-700 hover:underline">View all →</Link>} /></div>
            <DataTable rows={projects} rowKey={(r) => r.project_id} onRowClick={(r) => navigate(`/agency/projects/${r.project_id}`)}
              empty={<EmptyState title="No projects assigned yet" />}
              columns={[
                { key: 'name', header: 'Project', render: (r) => <div><div className="font-medium text-slate-800">{r.name}</div><div className="text-xs text-slate-400">{r.project_code}</div></div> },
                { key: 'progress', header: 'Progress vs plan', className: 'min-w-[170px]', render: (r) => (
                  <div><div className="mb-1 flex justify-between text-xs"><b>{r.progress}%</b><span className="text-slate-400">plan {r.planned_progress ?? '—'}%</span></div><ProgressBar value={r.progress} planned={r.planned_progress} /></div>
                ) },
                { key: 'delay_days', header: 'Delay', render: (r) => (r.delay_days > 0 ? <span className="text-orange-700">{r.delay_days} d</span> : <span className="text-slate-400">—</span>) },
                { key: 'agency_status', header: 'Status', render: (r) => <div className="flex flex-col items-start gap-1"><StatusBadge status={r.agency_status} />{r.report_pending && <span className="text-[11px] text-yellow-700">Report due</span>}</div> },
              ]} />
            {attention.length === 0 && projects.length > 0 && <p className="px-4 pb-4 pt-2 text-xs text-slate-500">All projects are on schedule with reports up to date.</p>}
          </Card>
        </div>
      )}
    </>
  )
}
