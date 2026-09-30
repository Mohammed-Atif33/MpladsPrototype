import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { fmtDate, inrFull } from '../../lib/format'
import { Card, DataTable, EmptyState, ErrorBanner, Notice, PageHeader, Spinner, StatusBadge, useApi } from '../../components/ui'

const FILTERS = ['', 'Pending', 'Approved', 'Rejected']

export default function AgencyRequests() {
  const [status, setStatus] = useState('')
  const { data, loading, error, reload } = useApi(() => api.get('/api/requests', { status }), [status])
  const rows = data || []

  return (
    <>
      <PageHeader title="Extension & Budget Requests" subtitle="Track every request your agency has sent to the officer." />
      <Notice className="mb-4">To make a new request, open the project from <Link to="/agency/projects" className="font-medium underline">Assigned Projects</Link> and use the Requests tab.</Notice>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f || 'all'} onClick={() => setStatus(f)} className={`pill ${status === f ? 'bg-navy-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{f || 'All'}</button>
        ))}
      </div>
      <ErrorBanner error={error} onRetry={reload} className="mb-4" />
      {loading && !data ? <Spinner /> : (
        <DataTable rows={rows} rowKey={(r) => r.request_id}
          empty={<Card><EmptyState title="No requests found" hint={status ? 'No requests with this status.' : 'You have not made any requests yet.'} /></Card>}
          columns={[
            { key: 'created_at', header: 'Submitted', render: (r) => fmtDate(r.created_at) },
            { key: 'project', header: 'Project', render: (r) => <Link to={`/agency/projects/${r.project_id}`} className="font-medium text-navy-700 hover:underline">{r.project_name}<div className="text-xs font-normal text-slate-400">{r.project_code}</div></Link> },
            { key: 'request_type', header: 'Type' },
            { key: 'ask', header: 'Requested', render: (r) => (r.request_type === 'Extension' ? `Deadline → ${fmtDate(r.requested_deadline)}` : `Sanction → ${inrFull(r.requested_amount)}`) },
            { key: 'justification', header: 'Justification', className: 'max-w-xs text-xs' },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'decision_note', header: 'Officer decision', className: 'max-w-xs text-xs', render: (r) => (r.decision_note ? <div><div>{r.decision_note}</div><div className="text-slate-400">{fmtDate(r.decided_at)}</div></div> : <span className="text-slate-400">Awaiting decision</span>) },
          ]} />
      )}
    </>
  )
}
