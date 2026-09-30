import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LayoutGrid, Map as MapIcon, RotateCcw } from 'lucide-react'
import { api } from '../../lib/api'
import { Card, EmptyState, ErrorBanner, Field, MapLegend, MapView, PageHeader, SearchBox, Select, Spinner, useApi, useDebounced } from '../../components/ui'
import ProjectCard from '../../components/portal/ProjectCard'

const PAGE_SIZE = 12
const PROGRESS = [
  ['', 'Any progress'], ['0-25', '0 – 25%'], ['25-50', '25 – 50%'], ['50-75', '50 – 75%'], ['75-100', '75 – 100%'],
]

export default function CitizenProjects() {
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState(sp.get('q') || '')
  const [category, setCategory] = useState('')
  const [district, setDistrict] = useState('')
  const [agencyId, setAgencyId] = useState('')
  const [status, setStatus] = useState('')
  const [riskLevel, setRiskLevel] = useState('')
  const [progress, setProgress] = useState('')
  const [view, setView] = useState('grid')
  const [page, setPage] = useState(1)
  const dq = useDebounced(q, 350)

  // keep ?q= in sync so the search can be shared / restored
  useEffect(() => {
    const next = new URLSearchParams(sp)
    if (dq) next.set('q', dq); else next.delete('q')
    setSp(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq])

  const meta = useApi(() => api.get('/api/meta'), [])
  useEffect(() => { setPage(1) }, [dq, category, district, agencyId, status, riskLevel, progress, view])

  const [pmin, pmax] = progress ? progress.split('-') : [undefined, undefined]
  const list = useApi(() => api.get('/api/projects', {
    q: dq, category, district, agency_id: agencyId, status, risk_level: riskLevel, progress_min: pmin, progress_max: pmax,
    page: view === 'map' ? 1 : page, page_size: view === 'map' ? 100 : PAGE_SIZE,
  }), [dq, category, district, agencyId, status, riskLevel, progress, page, view])

  const items = list.data?.items || []
  const total = list.data?.total || 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const reset = () => { setQ(''); setCategory(''); setDistrict(''); setAgencyId(''); setStatus(''); setRiskLevel(''); setProgress('') }
  const filtered = q || category || district || agencyId || status || riskLevel || progress

  return (
    <>
      <PageHeader title="Find Projects" subtitle="Search public development projects and see how they are progressing."
        actions={(
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300 bg-white">
            <button className={`px-3 py-1.5 text-sm ${view === 'grid' ? 'bg-navy-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => setView('grid')}><LayoutGrid className="mr-1 inline h-4 w-4" />Cards</button>
            <button className={`px-3 py-1.5 text-sm ${view === 'map' ? 'bg-navy-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => setView('map')}><MapIcon className="mr-1 inline h-4 w-4" />Map</button>
          </div>
        )} />

      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <Field label="Search" className="lg:col-span-2"><SearchBox value={q} onChange={setQ} placeholder="Name, place, description…" /></Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{(meta.data?.categories || []).map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          <Field label="District">
            <Select value={district} onChange={(e) => setDistrict(e.target.value)}><option value="">All districts</option>{(meta.data?.districts || []).map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          <Field label="Agency">
            <Select value={agencyId} onChange={(e) => setAgencyId(e.target.value)}><option value="">All agencies</option>{(meta.data?.agencies || []).map((a) => <option key={a.agency_id} value={a.agency_id}>{a.name}</option>)}</Select>
          </Field>
          <Field label="Risk Level">
            <Select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)}>
              <option value="">All risk levels</option>
              {['Low', 'Medium', 'High', 'Critical'].map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{['On track', 'Delayed', 'Completed'].map((s) => <option key={s}>{s}</option>)}</Select>
          </Field>
          <Field label="Progress">
            <Select value={progress} onChange={(e) => setProgress(e.target.value)}>{PROGRESS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </Field>
          <div className="flex items-end lg:col-span-7">{filtered && <button className="btn-secondary btn-sm" onClick={reset}><RotateCcw className="h-3.5 w-3.5" /> Clear filters</button>}</div>
        </div>
      </Card>

      <ErrorBanner error={list.error} onRetry={list.reload} className="mb-4" />
      {list.loading && !list.data ? <Spinner /> : items.length === 0 ? (
        <Card><EmptyState title="No projects match your search" hint="Try removing a filter or searching for a different word." /></Card>
      ) : view === 'map' ? (
        <>
          <div className="mb-2 text-sm text-slate-500">Showing {items.length} of {total} projects on the map</div>
          <MapView projects={items} colorBy="status" linkTo={(p) => `/citizen/projects/${p.project_id}`} height={520} />
          <MapLegend colorBy="status" />
        </>
      ) : (
        <>
          <div className="mb-3 text-sm text-slate-500">{total} project{total === 1 ? '' : 's'} found</div>
          <div className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-3 ${list.loading ? 'opacity-60' : ''}`}>{items.map((p) => <ProjectCard key={p.project_id} p={p} />)}</div>
          {pages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</button>
              <span className="text-sm text-slate-600">Page {page} of {pages}</span>
              <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </>
  )
}
