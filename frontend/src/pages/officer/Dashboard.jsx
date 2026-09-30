import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Briefcase, ClipboardCheck, Eye, FolderKanban, Inbox, MessageSquareWarning, ShieldAlert } from 'lucide-react'
import { api } from '../../lib/api'
import { RISK_COLOURS } from '../../lib/nav'
import { fmtDateTime } from '../../lib/format'
import { Card, CardHeader, DataTable, EmptyState, ErrorBanner, KpiCard, Notice, PageHeader, RiskBadge, Spinner, useApi } from '../../components/ui'
import { RiskDonut, levelForScore } from '../../components/officer/common'

export default function OfficerDashboard() {
  const { data, loading, error, reload } = useApi(() => api.get('/api/dashboard'), [])
  if (loading && !data) return <Spinner />
  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />
  const k = data.kpis
  const statusData = (data.by_status || []).map((s) => ({ ...s, short: s.name.length > 26 ? `${s.name.slice(0, 24)}…` : s.name }))

  return (
    <>
      <PageHeader title="Officer Dashboard" subtitle="Project monitoring, verification queue and risk review" />
      <ErrorBanner error={error} onRetry={reload} className="mb-4" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Projects" value={k.total_projects} icon={FolderKanban} tone="blue" hint={`${k.historical_records} historical records`} to="/officer/projects" />
        <KpiCard label="Projects Under Review" value={k.under_review} icon={Eye} tone="yellow" to="/officer/projects?status=Under Review" />
        <KpiCard label="High Risk" value={k.high_risk} icon={AlertTriangle} tone="orange" to="/officer/projects?risk_level=High&sort=risk_score&order=desc" />
        <KpiCard label="Critical Risk" value={k.critical_risk} icon={ShieldAlert} tone="red" to="/officer/projects?risk_level=Critical&sort=risk_score&order=desc" />
        <KpiCard label="Pending Verification" value={k.pending_verification} icon={ClipboardCheck} tone="purple" to="/officer/extractions" />
        <KpiCard label="Pending Complaints" value={k.pending_complaints} icon={MessageSquareWarning} tone="orange" to="/officer/complaints" hint="awaiting screening" />
        <KpiCard label="Pending Inspections" value={k.pending_inspections} icon={Briefcase} tone="blue" to="/officer/inspections" />
        <KpiCard label="Pending Agency Requests" value={k.pending_requests} icon={Inbox} tone="slate" to="/officer/requests" hint="extension / budget" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Risk distribution" subtitle="Latest analysis of live projects" />
          <RiskDonut data={data.risk_distribution} />
        </Card>
        <Card>
          <CardHeader title="Projects by status" />
          {statusData.length === 0 ? <EmptyState /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusData} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="short" width={150} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [v, 'Projects']} labelFormatter={(_, p) => p?.[0]?.payload?.name} />
                  <Bar dataKey="count" fill="#3b649a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Average risk by category" subtitle="Mean risk score of analysed live projects" />
          {(data.category_risk || []).length === 0 ? <EmptyState /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.category_risk} margin={{ left: -10, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={70} />
                  <YAxis domain={[0, 100]} />
                  <Tooltip formatter={(v) => [`${v}/100`, 'Average score']} />
                  <Bar dataKey="avg_score" radius={[4, 4, 0, 0]}>
                    {data.category_risk.map((c) => <Cell key={c.category} fill={RISK_COLOURS[levelForScore(c.avg_score)]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-5" pad={false}>
        <div className="p-4 pb-2"><CardHeader title="Recent risk analyses" actions={<Link to="/officer/projects" className="text-sm text-navy-700 hover:underline">All projects →</Link>} /></div>
        <DataTable
          rows={data.recent_analyses}
          rowKey={(r) => r.risk_id}
          empty={<EmptyState title="No analyses yet" hint="Upload a project PDF to run the first analysis." action={<Link className="btn-primary btn-sm" to="/officer/upload">Upload project PDF</Link>} />}
          columns={[
            { key: 'project', header: 'Project', render: (r) => <Link className="font-medium text-navy-700 hover:underline" to={`/officer/projects/${r.project_id}`}>{r.project_name}<div className="text-xs font-normal text-slate-500">{r.project_code}</div></Link> },
            { key: 'risk', header: 'Risk', render: (r) => <RiskBadge level={r.risk_level} score={r.risk_score} /> },
            { key: 'timestamp', header: 'Analysed', render: (r) => fmtDateTime(r.timestamp) },
          ]}
        />
      </Card>

      <Notice tone="yellow" className="mt-5">
        Prototype risk thresholds - not official government thresholds. (0–29 Low · 30–59 Medium · 60–79 High · 80–100 Critical.)
        A risk score is an investigation / prioritisation signal, not proof of wrongdoing.
      </Notice>
    </>
  )
}
