import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Award, CheckCircle2, ExternalLink, Globe, Landmark, MapPin,
  RefreshCw, ShieldCheck, Sparkles, Star, TrendingUp, Users,
} from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDate, inr, pct } from '../../lib/format'
import {
  Card, CardHeader, DataTable, EmptyState, ErrorBanner, Notice, PageHeader,
  ProgressBar, Spinner, StatusBadge, useApi,
} from '../../components/ui'

export default function MpTransparency() {
  const { data: dash, loading: loadingDash } = useApi(() => api.get('/api/dashboard'), [])
  const { data: projectsData, loading: loadingProjects, reload } = useApi(
    () => api.get('/api/projects', { scope: 'live', page_size: 50 }),
    []
  )

  if (loadingDash && !dash) return <Spinner className="min-h-[50vh]" label="Loading transparency scorecard…" />

  const projects = projectsData?.items || []
  const completedProjects = projects.filter((p) => p.progress >= 100 || p.completion_date)
  const activeProjects = projects.filter((p) => p.progress < 100 && !p.completion_date)

  const ch = dash?.charts || {}
  const fin = ch.financial || { sanctioned: 0, released: 0, expenditure: 0 }
  const utilizationRate = fin.sanctioned > 0 ? (fin.expenditure / fin.sanctioned) * 100 : 0

  return (
    <>
      <PageHeader
        back={{ to: '/mp', label: 'Dashboard' }}
        title="Public Transparency & Accountability Scorecard"
        subtitle="Constituency report card detailing fund utilization, completed infrastructure assets, and public civic satisfaction"
        actions={
          <div className="flex gap-2">
            <Link to="/citizen/projects" target="_blank" className="btn-secondary">
              <Globe className="h-4 w-4" /> Open Citizen View
            </Link>
            <button onClick={reload} className="btn-secondary" title="Refresh scorecard">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        }
      />

      {/* Top Scorecard Hero Card */}
      <div className="mb-6 rounded-xl border border-navy-800 bg-gradient-to-r from-navy-950 via-navy-900 to-navy-800 p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
              <Landmark className="h-4 w-4" /> Pune Parliamentary Constituency
            </div>
            <h2 className="mt-1 text-2xl font-bold !text-white sm:text-3xl">MPLADS Development Performance</h2>
            <p className="mt-1 max-w-xl text-sm text-navy-200">
              Delivering verified public infrastructure through transparent procurement, accountable execution, and citizen participation.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-white/10 p-3 backdrop-blur border border-white/15">
            <Award className="h-8 w-8 text-amber-300" />
            <div>
              <div className="text-xl font-bold text-white">{completedProjects.length} Assets</div>
              <div className="text-xs text-navy-200">Commissioned & Completed</div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-navy-700/60 pt-5 sm:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-navy-300">Sanctioned Quota</div>
            <div className="mt-1 text-xl font-bold text-white">{inr(fin.sanctioned)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-navy-300">Disbursed Funds</div>
            <div className="mt-1 text-xl font-bold text-white">{inr(fin.released)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-navy-300">Actual Expenditure</div>
            <div className="mt-1 text-xl font-bold text-white">{inr(fin.expenditure)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-navy-300">Fund Utilization</div>
            <div className="mt-1 text-xl font-bold text-amber-300">{pct(utilizationRate)}</div>
          </div>
        </div>
      </div>

      {/* Completed Works Showcase */}
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Delivered Infrastructure Works</h3>
            <p className="text-xs text-slate-500">Public assets completed and commissioned for community usage</p>
          </div>
          <span className="pill bg-emerald-100 text-emerald-800 font-semibold">
            {completedProjects.length} Verified Complete
          </span>
        </div>

        {completedProjects.length === 0 ? (
          <Card>
            <EmptyState title="No completed projects yet" hint="Ongoing projects will appear here once 100% progress is recorded." />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {completedProjects.map((p) => (
              <Card key={p.project_id} className="border-emerald-200 hover:shadow-md transition">
                <div className="flex items-start justify-between gap-2">
                  <span className="pill bg-emerald-100 text-emerald-800 font-semibold text-xs">
                    Completed
                  </span>
                  <span className="font-mono text-xs font-semibold text-slate-500">{p.project_code}</span>
                </div>
                <h4 className="mt-2 text-base font-bold text-slate-900 line-clamp-1">{p.name}</h4>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                  <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span>{p.location || p.district}</span>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Sanctioned Cost:</span>
                    <span className="font-bold text-slate-900">{inr(p.sanctioned_amount)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-slate-500">Agency:</span>
                    <span className="font-medium text-slate-700 truncate max-w-[150px]">{p.agency || 'PWD'}</span>
                  </div>
                </div>

                <div className="mt-4 pt-2">
                  <Link
                    to={`/mp/projects/${p.project_id}`}
                    className="btn-secondary btn-sm w-full text-center text-navy-700"
                  >
                    View Project Case Record →
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Active Pipeline Transparency Table */}
      <Card pad={false}>
        <div className="p-4 border-b border-slate-200">
          <CardHeader
            title="Public Constituency Works Register"
            subtitle="Full register of public development projects in progress with verified physical completion percentages"
            icon={Globe}
          />
        </div>
        <DataTable
          rows={projects}
          rowKey={(p) => p.project_id}
          columns={[
            {
              key: 'code',
              header: 'Code',
              render: (p) => (
                <Link to={`/mp/projects/${p.project_id}`} className="font-mono text-xs font-bold text-navy-700 hover:underline">
                  {p.project_code}
                </Link>
              ),
            },
            {
              key: 'name',
              header: 'Project Title',
              render: (p) => (
                <div className="max-w-xs">
                  <div className="font-medium text-slate-900">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.category}</div>
                </div>
              ),
            },
            {
              key: 'agency',
              header: 'Executing Agency',
              render: (p) => <span className="text-xs text-slate-700">{p.agency || '—'}</span>,
            },
            {
              key: 'progress',
              header: 'Progress',
              render: (p) => (
                <div className="w-28">
                  <div className="mb-0.5 text-xs font-bold text-slate-800">{pct(p.progress)}</div>
                  <ProgressBar value={p.progress} />
                </div>
              ),
            },
            {
              key: 'budget',
              header: 'Budget',
              render: (p) => <span className="font-semibold text-xs text-slate-800">{inr(p.sanctioned_amount)}</span>,
            },
            {
              key: 'status',
              header: 'Public Status',
              render: (p) => (
                p.progress >= 100 ? (
                  <span className="pill bg-emerald-100 text-emerald-800 font-semibold text-xs">Completed</span>
                ) : p.delay_days > 0 ? (
                  <span className="pill bg-orange-100 text-orange-800 font-semibold text-xs">Delayed</span>
                ) : (
                  <span className="pill bg-blue-100 text-blue-800 font-semibold text-xs">On Track</span>
                )
              ),
            },
            {
              key: 'action',
              header: '',
              render: (p) => (
                <Link to={`/mp/projects/${p.project_id}`} className="btn-secondary btn-sm text-navy-700">
                  Inspect
                </Link>
              ),
            },
          ]}
        />
      </Card>

      <Notice tone="blue" className="mt-5">
        <b>Open Governance Commitment:</b> Citizens are encouraged to inspect local MPLADS assets, review photographic documentation, and report defects through the public Citizen Portal.
      </Notice>
    </>
  )
}
