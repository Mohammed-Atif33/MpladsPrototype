import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { inr } from '../../lib/format'
import { Card, DataTable, EmptyState, ErrorBanner, Field, PageHeader, ProgressBar, SearchBox, Select, Spinner, StatusBadge, useApi, useDebounced } from '../../components/ui'

/** Suggested next step for the agency, derived from what the API tells it about the project. */
function nextAction(p) {
  switch (p.agency_status) {
    case 'Clarification requested': return 'Respond to the officer’s clarification'
    case 'Additional evidence requested': return 'Upload supporting evidence'
    case 'Inspection pending': return 'Prepare for the site inspection'
    case 'Completed': return 'None - project completed'
    default: return p.delay_days > 0 ? 'Explain the delay in your next report' : 'Submit the monthly progress report'
  }
}

export default function AgencyProjects() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const dq = useDebounced(q, 300)
  const { data, loading, error, reload } = useApi(() => api.get('/api/projects', { q: dq, status, page_size: 100 }), [dq, status])
  const items = data?.items || []

  return (
    <>
      <PageHeader title="Assigned Projects" subtitle="Projects allocated to your agency. Open a project to report progress, upload evidence or make requests." />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Search" className="sm:col-span-2"><SearchBox value={q} onChange={setQ} placeholder="Project name, code or location…" /></Field>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['On track', 'Delayed', 'Completed'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        </div>
      </Card>
      <ErrorBanner error={error} onRetry={reload} className="mb-4" />
      {loading && !data ? <Spinner /> : (
        <DataTable rows={items} rowKey={(r) => r.project_id} onRowClick={(r) => navigate(`/agency/projects/${r.project_id}`)}
          empty={<Card><EmptyState title="No projects found" hint="Try clearing the search or filter." /></Card>}
          columns={[
            { key: 'project_code', header: 'Code', render: (r) => <span className="font-mono text-xs">{r.project_code}</span> },
            { key: 'name', header: 'Project', render: (r) => <div><div className="font-medium text-slate-800">{r.name}</div><div className="text-xs text-slate-400">{r.category} · {r.location}</div></div> },
            { key: 'progress', header: 'Progress vs plan', className: 'min-w-[170px]', render: (r) => (
              <div><div className="mb-1 flex justify-between text-xs"><b>{r.progress}%</b><span className="text-slate-400">plan {r.planned_progress ?? '—'}%</span></div><ProgressBar value={r.progress} planned={r.planned_progress} /></div>
            ) },
            { key: 'spend', header: 'Spent / sanctioned', render: (r) => <div className="text-xs"><div>{inr(r.expenditure)}</div><div className="text-slate-400">of {inr(r.sanctioned_amount)}</div></div> },
            { key: 'delay_days', header: 'Delay', render: (r) => (r.delay_days > 0 ? <span className="text-orange-700">{r.delay_days} days</span> : <span className="text-slate-400">—</span>) },
            { key: 'agency_status', header: 'Status', render: (r) => <StatusBadge status={r.agency_status} /> },
            { key: 'next', header: 'Next action', className: 'min-w-[200px] text-xs text-slate-600', render: nextAction },
          ]} />
      )}
    </>
  )
}
