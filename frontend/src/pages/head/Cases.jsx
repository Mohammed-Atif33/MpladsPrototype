import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { inr } from '../../lib/format'
import { Card, DataTable, EmptyState, ErrorBanner, PageHeader, ProgressBar, RiskBadge, Spinner, StatusBadge, Tabs, useApi } from '../../components/ui'

const ESCALATED = ['Escalated to Head Officer', 'Escalated Further', 'Supervisory Review', 'Reopened', 'Evidence Requested']

const TESTS = {
  escalated: (p) => (p.case_level || 0) >= 2 || ESCALATED.includes(p.status),
  critical: (p) => p.latest_risk?.risk_level === 'Critical',
  high: (p) => p.latest_risk?.risk_level === 'High',
  all: (p) => (p.case_level || 0) >= 2 || ESCALATED.includes(p.status) || ['High', 'Critical'].includes(p.latest_risk?.risk_level),
}

export default function HeadCases() {
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const tab = TESTS[sp.get('tab')] ? sp.get('tab') : 'escalated'
  const { data, loading, error, reload } = useApi(() => api.get('/api/projects', { scope: 'live', page_size: 100, sort: 'risk_score', order: 'desc' }), [])

  const items = data?.items || []
  const counts = useMemo(() => Object.fromEntries(Object.entries(TESTS).map(([k, t]) => [k, items.filter(t).length])), [items])
  const rows = items.filter(TESTS[tab])

  return (
    <>
      <PageHeader title="Escalated & High-Risk Cases" subtitle="Cases that need supervisory review. Open a case to acknowledge, request evidence, reopen, assign an inspection, escalate or close." />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} tabs={[
        { key: 'escalated', label: 'Escalated', count: counts.escalated }, { key: 'critical', label: 'Critical', count: counts.critical },
        { key: 'high', label: 'High risk', count: counts.high }, { key: 'all', label: 'All requiring supervision', count: counts.all },
      ]} />
      <ErrorBanner error={error} onRetry={reload} className="mt-4" />
      <Card pad={false} className="mt-4">
        {loading && !data ? <Spinner /> : (
          <DataTable rows={rows} rowKey={(r) => r.project_id} onRowClick={(r) => navigate(`/head/projects/${r.project_id}`)}
            empty={<EmptyState title="No cases in this view" hint="Escalated and high-risk projects will appear here." />}
            columns={[
              { key: 'name', header: 'Project', render: (r) => <div className="min-w-[14rem]"><Link className="font-medium text-navy-700 hover:underline" to={`/head/projects/${r.project_id}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link><div className="text-xs text-slate-500">{r.project_code} · {r.category}</div></div> },
              { key: 'risk', header: 'Risk', render: (r) => <RiskBadge level={r.latest_risk?.risk_level} score={r.latest_risk?.risk_score} /> },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'agency', header: 'Agency', render: (r) => <span className="text-xs">{r.agency || '—'}</span> },
              { key: 'delay', header: 'Delay', render: (r) => (r.delay_days > 0 ? <span className="font-medium text-orange-700">{r.delay_days} d</span> : '—') },
              { key: 'progress', header: 'Progress', render: (r) => <div className="w-28"><div className="mb-1 text-xs text-slate-600">{r.progress}%{r.planned_progress != null ? ` / ${r.planned_progress}%` : ''}</div><ProgressBar value={r.progress} planned={r.planned_progress} /></div> },
              { key: 'budget', header: 'Budget', render: (r) => inr(r.sanctioned_amount) },
            ]} />
        )}
      </Card>
    </>
  )
}
