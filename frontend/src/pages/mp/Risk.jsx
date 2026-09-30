import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock,
  FileSearch, FolderKanban, HelpCircle, RefreshCw, ShieldAlert, Sparkles, TrendingDown,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../../lib/api'
import { inr, pct } from '../../lib/format'
import { RISK_COLOURS } from '../../lib/nav'
import {
  Card, CardHeader, DataTable, EmptyState, ErrorBanner, Notice, PageHeader,
  ProgressBar, RiskBadge, Spinner, StatusBadge, useApi,
} from '../../components/ui'
import { RiskDonut } from '../../components/officer/common'

export default function MpRisk() {
  const { data: dash, loading, error, reload } = useApi(() => api.get('/api/dashboard'), [])
  const { data: projectsData, loading: loadingProjects } = useApi(
    () => api.get('/api/projects', { scope: 'live', sort: 'risk_score', order: 'desc', page_size: 50 }),
    []
  )
  const { data: agenciesData } = useApi(() => api.get('/api/agencies'), [])

  if (loading && !dash) return <Spinner className="min-h-[50vh]" label="Computing constituency risk models…" />

  const projects = projectsData?.items || []
  const highCritical = projects.filter((p) => {
    const score = p.latest_risk?.risk_score
    return score != null && score >= 60
  })

  const k = dash?.kpis || {}

  // Compute agency risk counts
  const agencyRiskCounts = (agenciesData || []).map((a) => ({
    name: a.name.length > 20 ? `${a.name.slice(0, 18)}…` : a.name,
    fullName: a.name,
    highRiskCount: a.previous_high_risk_cases || 0,
    delayedCount: a.delayed_projects || 0,
  })).sort((a, b) => b.highRiskCount - a.highRiskCount)

  return (
    <>
      <PageHeader
        back={{ to: '/mp', label: 'Dashboard' }}
        title="Constituency Risk Intelligence Cockpit"
        subtitle="Predictive anomaly detection, delay patterns, financial outlier signals, and supervisory risk scores"
        actions={
          <button onClick={reload} className="btn-secondary">
            <RefreshCw className="h-4 w-4" /> Re-sync Models
          </button>
        }
      />

      <ErrorBanner error={error} onRetry={reload} className="mb-4" />

      {/* Top Banner Alert */}
      {highCritical.length > 0 && (
        <div className="mb-5 rounded-xl border border-red-200 bg-gradient-to-r from-red-50 to-orange-50 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-red-900">
                {highCritical.length} Project(s) Flagged for Priority Supervisory Attention
              </h3>
              <p className="mt-0.5 text-xs text-red-700">
                These works have triggered predictive signals including prolonged progress halts, repeated deadline revisions, or significant expenditure anomalies.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="border-l-4 border-l-red-600">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-700">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{k.high_risk_projects || highCritical.length}</div>
              <div className="text-xs font-medium text-slate-500">High & Critical Risk Works</div>
            </div>
          </div>
        </Card>

        <Card className="border-l-4 border-l-orange-500">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-700">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{k.delayed_projects || 0}</div>
              <div className="text-xs font-medium text-slate-500">Timeline Overrun Projects</div>
            </div>
          </div>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{k.requiring_attention || 0}</div>
              <div className="text-xs font-medium text-slate-500">Attention Required Items</div>
            </div>
          </div>
        </Card>

        <Card className="border-l-4 border-l-blue-600">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{agencyRiskCounts.length}</div>
              <div className="text-xs font-medium text-slate-500">Agencies Monitored</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Priority Flagged Projects Table */}
      <Card pad={false}>
        <div className="p-4 border-b border-slate-200">
          <CardHeader
            title="Constituency Risk Rankings"
            subtitle="Projects sorted by composite risk score (Rule Score + Isolation Forest Anomaly Detection)"
            icon={AlertTriangle}
            actions={
              <Link to="/mp/assignments" className="text-xs font-medium text-navy-700 hover:underline">
                Reassign Agency / Officer →
              </Link>
            }
          />
        </div>
        <DataTable
          rows={projects}
          rowKey={(r) => r.project_id}
          empty={<EmptyState title="No analysed projects" hint="Run risk analysis from the project case view." />}
          columns={[
            {
              key: 'code',
              header: 'Project Code',
              render: (r) => (
                <Link to={`/mp/projects/${r.project_id}`} className="font-semibold text-navy-700 hover:underline">
                  {r.project_code}
                </Link>
              ),
            },
            {
              key: 'name',
              header: 'Project Name',
              render: (r) => (
                <div className="max-w-xs">
                  <div className="font-medium text-slate-900">{r.name}</div>
                  <div className="text-xs text-slate-500">{r.category} · {r.location || r.district}</div>
                </div>
              ),
            },
            {
              key: 'agency',
              header: 'Executing Agency',
              render: (r) => <span className="text-xs text-slate-700">{r.agency || '—'}</span>,
            },
            {
              key: 'risk_badge',
              header: 'Risk Score',
              render: (r) => (
                r.latest_risk ? (
                  <RiskBadge level={r.latest_risk.risk_level} score={r.latest_risk.risk_score} />
                ) : (
                  <span className="text-xs text-slate-400">Not Analysed</span>
                )
              ),
            },
            {
              key: 'progress',
              header: 'Physical Progress',
              render: (r) => (
                <div className="w-24">
                  <div className="mb-0.5 text-xs font-semibold text-slate-700">{pct(r.progress)}</div>
                  <ProgressBar value={r.progress} />
                </div>
              ),
            },
            {
              key: 'delay',
              header: 'Delay',
              render: (r) => (
                r.delay_days > 0 ? (
                  <span className="pill bg-orange-100 text-orange-800 text-xs font-medium">+{r.delay_days}d</span>
                ) : (
                  <span className="pill bg-emerald-100 text-emerald-800 text-xs font-medium">On track</span>
                )
              ),
            },
            {
              key: 'actions',
              header: 'Investigation',
              render: (r) => (
                <Link to={`/mp/projects/${r.project_id}`} className="btn-secondary btn-sm flex items-center gap-1 text-navy-700">
                  <FileSearch className="h-3.5 w-3.5" /> Case File
                </Link>
              ),
            },
          ]}
        />
      </Card>

      {/* Visual Analytics */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Agency Historical Risk Exposure"
            subtitle="Past high-risk projects associated with executing agencies"
          />
          {agencyRiskCounts.length === 0 ? <EmptyState /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agencyRiskCounts} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [v, 'High-Risk Cases']} labelFormatter={(_, p) => p?.[0]?.payload?.fullName} />
                  <Bar dataKey="highRiskCount" fill="#e11d48" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Risk Factor Methodology"
            subtitle="How automated risk signals are calculated"
          />
          <div className="space-y-3 text-xs text-slate-600">
            <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
              <b className="text-slate-800">1. Timeline Overruns & Delay Ratios:</b>
              <p className="mt-0.5">Calculated relative to peer completion benchmarks for identical project categories.</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
              <b className="text-slate-800">2. Budget Variation & Repeated Extensions:</b>
              <p className="mt-0.5">Flags frequent requests for contract cost escalations or revised deadlines.</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
              <b className="text-slate-800">3. Isolation Forest Anomaly Detection:</b>
              <p className="mt-0.5">Machine learning isolation scores identifying non-linear multidimensional outliers compared to hundreds of historical records.</p>
            </div>
          </div>
        </Card>
      </div>

      <Notice tone="yellow" className="mt-5">
        <b>Prototype Threshold Disclaimer:</b> Risk levels (Low &lt;30, Medium 30-59, High 60-79, Critical 80-100) are decision-support indicators developed to aid supervisory inspection scheduling. They are not legal determinations of misconduct.
      </Notice>
    </>
  )
}
