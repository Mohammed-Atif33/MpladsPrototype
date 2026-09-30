import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useBasePath } from '../../lib/nav'
import { Card, CardHeader, ErrorBanner, MapLegend, MapView, PageHeader, RiskBadge, Spinner, useApi } from '../../components/ui'

export default function MapPage() {
  const base = useBasePath()
  const { data, loading, error, reload } = useApi(() => api.get('/api/projects', { page_size: 100, sort: 'risk_score', order: 'desc' }), [])
  const items = data?.items || []
  return (
    <>
      <PageHeader title="Project Map" subtitle="Live project locations coloured by risk level (synthetic locations around Pune / Maharashtra)" />
      <ErrorBanner error={error} onRetry={reload} className="mb-3" />
      {loading && !data ? <Spinner /> : (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <MapView projects={items} colorBy="risk" linkTo={(p) => `${base}/projects/${p.project_id}`} height={560} />
            <MapLegend colorBy="risk" />
            <p className="mt-2 text-xs text-slate-500">Grey markers have not been analysed yet. Risk levels are prioritisation signals, not findings of wrongdoing.</p>
          </Card>
          <Card>
            <CardHeader title="Projects" subtitle={`${items.length} live project(s), highest risk first`} />
            <ul className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
              {items.map((p) => (
                <li key={p.project_id} className="flex items-center justify-between gap-2 py-2">
                  <Link to={`${base}/projects/${p.project_id}`} className="min-w-0 flex-1 text-sm hover:underline"><div className="truncate font-medium text-slate-800">{p.name}</div><div className="text-xs text-slate-500">{p.project_code} · {p.progress}%</div></Link>
                  <RiskBadge level={p.latest_risk?.risk_level} score={p.latest_risk?.risk_score} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  )
}
