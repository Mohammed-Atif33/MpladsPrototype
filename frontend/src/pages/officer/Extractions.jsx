import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileUp } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import { Card, DataTable, EmptyState, ErrorBanner, PageHeader, Pill, Select, Spinner, StatusBadge, useApi } from '../../components/ui'

const STATUSES = ['Pending Verification', 'Verified', 'Discarded']

export default function Extractions() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('Pending Verification')
  const { data, loading, error, reload } = useApi(() => api.get('/api/extractions', { status }), [status])

  return (
    <>
      <PageHeader title="Verification Queue" subtitle="Extracted project data awaiting officer verification. Unverified data is never analysed."
        actions={<Link className="btn-primary" to="/officer/upload"><FileUp className="h-4 w-4" /> Upload project PDF</Link>} />
      <div className="mb-3 flex items-center gap-3">
        <label className="text-sm text-slate-600">Status</label>
        <Select className="!w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
      </div>
      <ErrorBanner error={error} onRetry={reload} className="mb-3" />
      <Card pad={false}>
        {loading && !data ? <Spinner /> : (
          <DataTable
            rows={data || []}
            rowKey={(r) => r.extraction_id}
            onRowClick={(r) => navigate(`/officer/extractions/${r.extraction_id}`)}
            empty={<EmptyState title={`No ${status.toLowerCase()} extractions`} hint="Upload a project PDF to start." />}
            columns={[
              { key: 'file', header: 'PDF', render: (r) => <span className="font-medium text-slate-800">{r.file_name || '—'}</span> },
              { key: 'project', header: 'Project', render: (r) => <div>{r.project_name || '—'}<div className="text-xs text-slate-500">{r.project_code || 'no ID extracted'}</div></div> },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'validation', header: 'Validation', render: (r) => (
                <span className="flex gap-1.5">
                  <Pill tone={r.errors ? 'red' : 'green'}>{r.errors} error{r.errors === 1 ? '' : 's'}</Pill>
                  <Pill tone={r.warnings ? 'yellow' : 'green'}>{r.warnings} warning{r.warnings === 1 ? '' : 's'}</Pill>
                </span>) },
              { key: 'uploaded_by', header: 'Uploaded by' },
              { key: 'created_at', header: 'Uploaded', render: (r) => fmtDateTime(r.created_at) },
              { key: 'open', header: '', render: (r) => (
                <span onClick={(e) => e.stopPropagation()}>
                  {r.project_id
                    ? <Link className="text-sm text-navy-700 hover:underline" to={`/officer/projects/${r.project_id}`}>Open project →</Link>
                    : <Link className="btn-primary btn-sm" to={`/officer/extractions/${r.extraction_id}`}>{r.status === 'Pending Verification' ? 'Review & verify' : 'View'}</Link>}
                </span>) },
            ]}
          />
        )}
      </Card>
    </>
  )
}
