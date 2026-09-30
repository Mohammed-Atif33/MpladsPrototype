import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PlusCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { Card, DataTable, EmptyState, ErrorBanner, Field, Pill, PageHeader, SearchBox, Select, Spinner, StatusBadge, useApi, useDebounced } from '../../components/ui'

const STATUSES = ['Submitted', 'Assigned', 'Under Investigation', 'Resolved', 'Appealed', 'Rejected', 'Closed']

export default function CitizenComplaints() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const dq = useDebounced(q, 300)
  const { data, loading, error, reload } = useApi(() => api.get('/api/complaints', { q: dq, status, page_size: 100 }), [dq, status])
  const items = data?.items || []

  return (
    <>
      <PageHeader title="My Complaints" subtitle="Track every complaint you have submitted."
        actions={<Link to="/citizen/complaints/new" className="btn-primary"><PlusCircle className="h-4 w-4" /> New complaint</Link>} />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Search" className="sm:col-span-2"><SearchBox value={q} onChange={setQ} placeholder="Tracking ID, category or words in the description…" /></Field>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        </div>
      </Card>
      <ErrorBanner error={error} onRetry={reload} className="mb-4" />
      {loading && !data ? <Spinner /> : (
        <DataTable rows={items} rowKey={(r) => r.complaint_id} onRowClick={(r) => navigate(`/citizen/complaints/${r.complaint_id}`)}
          empty={<Card><EmptyState title="No complaints found" hint="Complaints you submit will appear here with their tracking ID." action={<Link to="/citizen/complaints/new" className="btn-primary btn-sm">Submit a complaint</Link>} /></Card>}
          columns={[
            { key: 'tracking_id', header: 'Tracking ID', render: (r) => <span className="font-mono text-xs font-semibold text-navy-800">{r.tracking_id}</span> },
            { key: 'project', header: 'Project', render: (r) => <div><div className="font-medium text-slate-800">{r.project_name || '—'}</div><div className="text-xs text-slate-400">{r.project_code}</div></div> },
            { key: 'category', header: 'Category' },
            { key: 'status', header: 'Status', render: (r) => <div className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.anonymous && <Pill>Anonymous</Pill>}</div> },
            { key: 'created_at', header: 'Submitted', render: (r) => fmtDate(r.created_at) },
          ]} />
      )}
    </>
  )
}
