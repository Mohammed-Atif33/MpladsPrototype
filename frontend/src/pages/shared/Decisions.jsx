import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { api } from '../../lib/api'
import { useBasePath } from '../../lib/nav'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { Card, DataTable, EmptyState, ErrorBanner, PageHeader, Pill, SearchBox, Select, Spinner, StatusBadge, useApi } from '../../components/ui'

const TONE = {
  'Escalate to Head Officer': 'red', 'Escalate Further': 'red', 'Clear for Routine Monitoring': 'green', 'Close Review': 'green',
  'Request Inspection': 'orange', 'Assign Inspection': 'orange', 'Request Clarification': 'yellow', 'Keep Under Review': 'yellow',
  Reopen: 'red', Acknowledge: 'blue', 'Request Evidence': 'orange', 'Add Supervisory Note': 'purple',
}

export default function Decisions() {
  const base = useBasePath()
  const { data, loading, error, reload } = useApi(() => api.get('/api/decisions', { limit: 500 }), [])
  const [type, setType] = useState('')
  const [q, setQ] = useState('')

  const types = useMemo(() => [...new Set((data || []).map((d) => d.decision))].sort(), [data])
  const rows = (data || []).filter((d) => (!type || d.decision === type)
    && (!q || `${d.project_code} ${d.project_name} ${d.reason} ${d.made_by}`.toLowerCase().includes(q.toLowerCase())))

  return (
    <>
      <PageHeader title="Decisions" subtitle="Officer decisions and Head Officer supervisory actions. Every entry has a matching audit record." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchBox className="!w-64" value={q} onChange={setQ} placeholder="Search project, reason, person…" />
        <Select className="!w-64" value={type} onChange={(e) => setType(e.target.value)}><option value="">All decision types</option>{types.map((t) => <option key={t}>{t}</option>)}</Select>
      </div>
      <ErrorBanner error={error} onRetry={reload} className="mb-3" />
      <Card pad={false}>
        {loading && !data ? <Spinner /> : (
          <DataTable rows={rows} rowKey={(r) => r.decision_id} empty={<EmptyState title="No decisions recorded" hint="Decisions appear here once officers review analysed projects." />}
            columns={[
              { key: 'decision', header: 'Decision', render: (r) => <Pill tone={TONE[r.decision] || 'slate'}>{r.decision}</Pill> },
              { key: 'project', header: 'Project', render: (r) => <Link className="font-medium text-navy-700 hover:underline" to={`${base}/projects/${r.project_id}`}>{r.project_name}<div className="text-xs font-normal text-slate-500">{r.project_code}</div></Link> },
              { key: 'made_by', header: 'By', render: (r) => <span className="text-sm">{r.made_by}<div className="text-xs text-slate-400">{r.role}</div></span> },
              { key: 'reason', header: 'Reason', render: (r) => <div className="max-w-sm text-sm">{r.reason}</div> },
              { key: 'evidence', header: 'Evidence reviewed', render: (r) => <div className="flex max-w-xs flex-wrap gap-1">{(r.evidence_reviewed || []).map((e) => <span key={e} className="pill bg-slate-100 text-slate-600">{e}</span>)}</div> },
              { key: 'follow', header: 'Follow-up', render: (r) => <span className="text-xs">{r.follow_up_date ? fmtDate(r.follow_up_date) : ''}{r.action ? <div>{r.action}</div> : null}{!r.follow_up_date && !r.action && '—'}</span> },
              { key: 'status', header: 'Status change', render: (r) => r.previous_status === r.new_status ? <StatusBadge status={r.new_status} /> : <div className="flex flex-wrap items-center gap-1"><StatusBadge status={r.previous_status} /><ArrowRight className="h-3 w-3 text-slate-400" /><StatusBadge status={r.new_status} /></div> },
              { key: 'created_at', header: 'When', render: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at)}</span> },
            ]} />
        )}
      </Card>
    </>
  )
}
