import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { api } from '../../lib/api'
import { useBasePath } from '../../lib/nav'
import { inr } from '../../lib/format'
import {
  Card, Checkbox, DataTable, EmptyState, ErrorBanner, PageHeader, ProgressBar, RiskBadge, SearchBox, Select, Spinner, StatusBadge, useApi, useDebounced,
} from '../../components/ui'

const PAGE_SIZE = 20

export default function Projects() {
  const base = useBasePath()
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  const [q, setQ] = useState(sp.get('q') || '')
  const [category, setCategory] = useState(sp.get('category') || '')
  const [district, setDistrict] = useState(sp.get('district') || '')
  const [agencyId, setAgencyId] = useState(sp.get('agency_id') || '')
  const [status, setStatus] = useState(sp.get('status') || '')
  const [riskLevel, setRiskLevel] = useState(sp.get('risk_level') || '')
  const [sort, setSort] = useState(sp.get('sort') || 'name')
  const [order, setOrder] = useState(sp.get('order') || 'asc')
  const [historical, setHistorical] = useState(sp.get('scope') === 'all')
  const [page, setPage] = useState(1)
  const dq = useDebounced(q, 350)

  const meta = useApi(() => api.get('/api/meta'), [])
  useEffect(() => { setPage(1) }, [dq, category, district, agencyId, status, riskLevel, sort, order, historical])

  const { data, loading, error, reload } = useApi(() => api.get('/api/projects', {
    q: dq, category, district, agency_id: agencyId, status, risk_level: riskLevel, sort, order,
    scope: historical ? 'all' : 'live', page, page_size: PAGE_SIZE,
  }), [dq, category, district, agencyId, status, riskLevel, sort, order, historical, page])

  const m = meta.data || {}
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const anyFilter = q || category || district || agencyId || status || riskLevel
  const clear = () => { setQ(''); setCategory(''); setDistrict(''); setAgencyId(''); setStatus(''); setRiskLevel('') }

  return (
    <>
      <PageHeader title="Projects & Risk" subtitle="Search, filter and open any project case" />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchBox className="sm:col-span-2 lg:col-span-2" value={q} onChange={setQ} placeholder="Search name, code, location…" />
          <Select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{(m.categories || []).map((c) => <option key={c}>{c}</option>)}</Select>
          <Select value={district} onChange={(e) => setDistrict(e.target.value)}><option value="">All districts</option>{(m.districts || []).map((c) => <option key={c}>{c}</option>)}</Select>
          <Select value={agencyId} onChange={(e) => setAgencyId(e.target.value)}><option value="">All agencies</option>{(m.agencies || []).map((a) => <option key={a.agency_id} value={a.agency_id}>{a.name}</option>)}</Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{(m.project_statuses || []).map((c) => <option key={c}>{c}</option>)}</Select>
          <Select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)}><option value="">All risk levels</option>{(m.risk_levels || ['Low', 'Medium', 'High', 'Critical']).map((c) => <option key={c}>{c}</option>)}</Select>
          <div className="flex gap-2">
            <Select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="name">Sort: Name</option><option value="risk_score">Sort: Risk score</option><option value="delay_days">Sort: Delay</option>
              <option value="progress">Sort: Progress</option><option value="sanctioned_amount">Sort: Budget</option><option value="created_at">Sort: Newest</option>
            </Select>
            <button className="btn-secondary" onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))} title="Toggle order">{order === 'asc' ? '↑' : '↓'}</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Checkbox checked={historical} onChange={setHistorical} label="Include historical records" hint="Adds the archive used for comparisons" />
          {anyFilter && <button className="btn-ghost btn-sm" onClick={clear}><X className="h-3.5 w-3.5" /> Clear filters</button>}
        </div>
      </Card>

      <ErrorBanner error={error} onRetry={reload} className="mb-3" />
      <Card pad={false}>
        {loading && !data ? <Spinner /> : (
          <DataTable
            rows={data?.items || []}
            rowKey={(r) => r.project_id}
            onRowClick={(r) => navigate(`${base}/projects/${r.project_id}`)}
            empty={<EmptyState title="No projects match" hint="Try clearing some filters." />}
            columns={[
              { key: 'name', header: 'Project', render: (r) => <div className="min-w-[14rem]"><div className="font-medium text-slate-900">{r.name}</div><div className="text-xs text-slate-500">{r.project_code} · {r.category}{r.is_historical ? ' · historical' : ''}</div></div> },
              { key: 'agency', header: 'Agency', render: (r) => <span className="text-xs">{r.agency || '—'}<div className="text-slate-400">{r.district}</div></span> },
              { key: 'progress', header: 'Progress', render: (r) => <div className="w-32"><div className="mb-1 text-xs text-slate-600">{r.progress}%{r.planned_progress != null ? ` of ${r.planned_progress}% planned` : ''}</div><ProgressBar value={r.progress} planned={r.planned_progress} /></div> },
              { key: 'delay_days', header: 'Delay', render: (r) => (r.delay_days > 0 ? <span className="font-medium text-orange-700">{r.delay_days} d</span> : <span className="text-slate-400">—</span>) },
              { key: 'budget', header: 'Budget', render: (r) => inr(r.sanctioned_amount) },
              { key: 'risk', header: 'Risk', render: (r) => <RiskBadge level={r.latest_risk?.risk_level} score={r.latest_risk?.risk_score} /> },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        )}
      </Card>

      {data && data.total > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span>{data.total} project{data.total === 1 ? '' : 's'} · page {page} of {totalPages}</span>
          <span className="flex gap-2">
            <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /> Prev</button>
            <button className="btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight className="h-4 w-4" /></button>
          </span>
        </div>
      )}
    </>
  )
}
