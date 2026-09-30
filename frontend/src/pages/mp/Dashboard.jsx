import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowRight, BarChart3, Briefcase, CheckCircle2, Clock, FolderKanban,
  HelpCircle, Inbox, Landmark, ListChecks, PlusCircle, ShieldAlert, Sparkles, TrendingUp, Users,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../../lib/api'
import { inr, pct } from '../../lib/format'
import { RISK_COLOURS } from '../../lib/nav'
import {
  Card, CardHeader, DataTable, EmptyState, ErrorBanner, KpiCard, Notice, PageHeader,
  ProgressBar, RiskBadge, Spinner, StatusBadge, useApi,
} from '../../components/ui'

const PROGRESS_COLORS = ['#94a3b8', '#38bdf8', '#3b82f6', '#8b5cf6', '#10b981']
const CATEGORY_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#6366f1']

export default function MpDashboard() {
  const { data, loading, error, reload } = useApi(() => api.get('/api/dashboard'), [])

  if (loading && !data) return <Spinner className="min-h-[50vh]" label="Loading constituency intelligence…" />
  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />

  const k = data.kpis || {}
  const ch = data.charts || {}
  const fin = ch.financial || { sanctioned: 0, released: 0, expenditure: 0 }
  const utilization = fin.sanctioned > 0 ? (fin.expenditure / fin.sanctioned) * 100 : 0
  const releaseRatio = fin.sanctioned > 0 ? (fin.released / fin.sanctioned) * 100 : 0

  const statusData = (ch.by_status || []).map((s) => ({
    ...s,
    short: s.name.length > 22 ? `${s.name.slice(0, 20)}…` : s.name,
  }))

  const progressData = ch.by_progress || []
  const categoryData = ch.by_category || []
  const districtData = ch.by_district || []

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-gradient-to-r from-navy-900 via-navy-800 to-navy-700 p-6 text-white shadow-lg">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
            <Landmark className="h-4 w-4" /> Member of Parliament · Constituency Oversight
          </div>
          <h1 className="mt-1 text-2xl font-bold !text-white sm:text-3xl">Pune Constituency Dashboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-navy-200">
            Real-time MPLADS progress tracking, stakeholder accountability, risk intelligence, and public fund utilization.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link to="/mp/create-project" className="btn bg-amber-400 font-semibold text-navy-900 hover:bg-amber-300 shadow-md">
            <PlusCircle className="h-4 w-4" /> Create New Project
          </Link>
          <Link to="/mp/assignments" className="btn bg-white/10 text-white backdrop-blur hover:bg-white/20">
            <ListChecks className="h-4 w-4" /> Manage Assignments
          </Link>
          <Link to="/mp/risk" className="btn bg-white/10 text-white backdrop-blur hover:bg-white/20">
            <AlertTriangle className="h-4 w-4 text-amber-300" /> Risk Cockpit
          </Link>
        </div>
      </div>

      <ErrorBanner error={error} onRetry={reload} className="mb-4" />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard
          label="Total Projects"
          value={k.total_projects}
          icon={FolderKanban}
          tone="blue"
          hint={`${k.active_projects} active · ${k.completed_projects} done`}
          to="/mp/projects"
        />
        <KpiCard
          label="Completed Works"
          value={k.completed_projects}
          icon={CheckCircle2}
          tone="green"
          hint="Verified physical completion"
          to="/mp/projects?status=Completed"
        />
        <KpiCard
          label="Delayed Projects"
          value={k.delayed_projects}
          icon={Clock}
          tone="orange"
          hint="Exceeding scheduled timeline"
          to="/mp/projects?status=Delayed"
        />
        <KpiCard
          label="Requires Attention"
          value={k.requiring_attention}
          icon={ShieldAlert}
          tone="red"
          hint="High risk or delay > 60d"
          to="/mp/risk"
        />
        <KpiCard
          label="Pending Requests"
          value={k.pending_agency_requests}
          icon={Inbox}
          tone="yellow"
          hint="Agency extension / budget"
          to="/mp/requests"
        />
      </div>

      {/* Financial Allocation & Fund Utilization */}
      <Card className="mt-5 border-navy-100 bg-gradient-to-br from-white to-slate-50 shadow-sm">
        <CardHeader
          title="Constituency Financial Overview"
          subtitle="Sanctioned budget, disbursed instalments, and documented project expenditure"
          icon={TrendingUp}
          actions={
            <Link to="/mp/transparency" className="text-xs font-medium text-navy-700 hover:underline">
              View Public Breakdown →
            </Link>
          }
        />
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Sanctioned</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{inr(fin.sanctioned)}</div>
            <div className="mt-2 text-xs text-slate-500">Approved constituency allocation</div>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-blue-700">Funds Released</div>
            <div className="mt-1 text-2xl font-bold text-blue-900">{inr(fin.released)}</div>
            <div className="mt-2 flex items-center justify-between text-xs text-blue-700">
              <span>{pct(releaseRatio)} of sanctioned</span>
              <span>Available for works</span>
            </div>
            <div className="mt-2">
              <ProgressBar value={releaseRatio} />
            </div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Total Expenditure</div>
            <div className="mt-1 text-2xl font-bold text-emerald-900">{inr(fin.expenditure)}</div>
            <div className="mt-2 flex items-center justify-between text-xs text-emerald-700">
              <span>Utilization: {pct(utilization)}</span>
              <span>Remaining: {inr(Math.max(0, fin.sanctioned - fin.expenditure))}</span>
            </div>
            <div className="mt-2">
              <ProgressBar value={utilization} />
            </div>
          </div>
        </div>
      </Card>

      {/* Analytics Charts Row */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* Status Distribution */}
        <Card>
          <CardHeader title="Project Pipeline Status" subtitle="Breakdown of projects across administrative workflows" />
          {statusData.length === 0 ? <EmptyState /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusData} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="short" width={150} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [v, 'Projects']} labelFormatter={(_, p) => p?.[0]?.payload?.name} />
                  <Bar dataKey="count" fill="#1e3a8a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Progress Tiers */}
        <Card>
          <CardHeader title="Physical Progress Distribution" subtitle="Active works categorized by completion percentage" />
          {progressData.length === 0 ? <EmptyState /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={progressData} margin={{ left: -10, right: 8, top: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(v) => [v, 'Projects']} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {progressData.map((_, i) => (
                      <Cell key={i} fill={PROGRESS_COLORS[i % PROGRESS_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Category Breakdown */}
        <Card>
          <CardHeader title="Sector / Category Allocation" subtitle="Project count across development sectors" />
          {categoryData.length === 0 ? <EmptyState /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} margin={{ left: -10, right: 8, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={60} />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(v) => [v, 'Projects']} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {categoryData.map((_, i) => (
                      <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* District Distribution */}
        <Card>
          <CardHeader title="Regional Distribution" subtitle="Projects distributed across regional districts" />
          {districtData.length === 0 ? <EmptyState /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={districtData} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="district" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [v, 'Projects']} />
                  <Bar dataKey="count" fill="#0d9488" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Recent / Key Projects Table */}
      <Card className="mt-5" pad={false}>
        <div className="p-4 pb-2">
          <CardHeader
            title="Active Constituency Works"
            subtitle="Recent projects with recorded progress and risk indicators"
            actions={
              <Link to="/mp/projects" className="text-sm font-medium text-navy-700 hover:underline">
                View all projects →
              </Link>
            }
          />
        </div>
        <DataTable
          rows={data.recent_projects || []}
          rowKey={(r) => r.project_id}
          empty={
            <EmptyState
              title="No projects found"
              hint="Create your first MPLADS constituency project."
              action={
                <Link className="btn-primary btn-sm" to="/mp/create-project">
                  Create New Project
                </Link>
              }
            />
          }
          columns={[
            {
              key: 'code',
              header: 'Project Code',
              render: (r) => (
                <Link className="font-semibold text-navy-700 hover:underline" to={`/mp/projects/${r.project_id}`}>
                  {r.project_code}
                </Link>
              ),
            },
            {
              key: 'name',
              header: 'Project Name',
              render: (r) => (
                <div>
                  <Link className="font-medium text-slate-800 hover:text-navy-700 hover:underline" to={`/mp/projects/${r.project_id}`}>
                    {r.name}
                  </Link>
                  <div className="text-xs text-slate-500">{r.category} · {r.district}</div>
                </div>
              ),
            },
            {
              key: 'agency',
              header: 'Implementing Agency',
              render: (r) => <span className="text-xs text-slate-700">{r.agency_name || '—'}</span>,
            },
            {
              key: 'progress',
              header: 'Progress',
              render: (r) => (
                <div className="w-28">
                  <div className="mb-1 text-xs font-semibold text-slate-700">{pct(r.progress)}</div>
                  <ProgressBar value={r.progress} />
                </div>
              ),
            },
            {
              key: 'delay',
              header: 'Timeline',
              render: (r) => (
                r.delay_days > 0 ? (
                  <span className="pill bg-orange-100 text-orange-800 font-medium">+{r.delay_days}d delayed</span>
                ) : (
                  <span className="pill bg-emerald-100 text-emerald-800 font-medium">On track</span>
                )
              ),
            },
            {
              key: 'status',
              header: 'Workflow Status',
              render: (r) => <StatusBadge status={r.status} />,
            },
            {
              key: 'risk',
              header: 'Risk Score',
              render: (r) => (
                r.risk_score != null ? (
                  <RiskBadge level={r.risk_level} score={r.risk_score} />
                ) : (
                  <span className="text-xs text-slate-400">Pending</span>
                )
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (r) => (
                <Link to={`/mp/projects/${r.project_id}`} className="btn-ghost btn-sm text-navy-700" title="Open Case File">
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ),
            },
          ]}
        />
      </Card>

      <Notice tone="yellow" className="mt-5">
        <b>MPLADS Risk Intelligence Notice:</b> Risk scores (0-29 Low, 30-59 Medium, 60-79 High, 80-100 Critical) are automated prioritisation signals powered by hybrid rule evaluation and Isolation Forest anomaly detection. They are designed to highlight works needing supervisory intervention, not to serve as proof of wrongdoing.
      </Notice>
    </>
  )
}
