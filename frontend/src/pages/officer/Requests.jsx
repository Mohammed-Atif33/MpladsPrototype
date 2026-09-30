import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDate, inr } from '../../lib/format'
import {
  Card, ConfirmDialog, DataTable, EmptyState, ErrorBanner, Field, PageHeader, Select, Spinner, StatusBadge, Textarea, useApi, useToast,
} from '../../components/ui'

export default function OfficerRequests() {
  const toast = useToast()
  const [status, setStatus] = useState('Pending')
  const { data, loading, error, reload } = useApi(() => api.get('/api/requests', { status: status || undefined }), [status])
  const [target, setTarget] = useState(null) // { request, decision }
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const open = (request, decision) => { setTarget({ request, decision }); setNote(''); setErr(null) }
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      await api.put(`/api/requests/${target.request.request_id}`, { decision: target.decision, note: note.trim() })
      toast(`Request ${target.decision === 'Approve' ? 'approved' : 'rejected'}. The agency has been notified.`)
      setTarget(null); reload()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  return (
    <>
      <PageHeader title="Agency Requests" subtitle="Extension and budget-change requests submitted by implementing agencies" />
      <div className="mb-3 flex items-center gap-3">
        <label className="text-sm text-slate-600">Status</label>
        <Select className="!w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option><option>Pending</option><option>Approved</option><option>Rejected</option>
        </Select>
      </div>
      <ErrorBanner error={error} onRetry={reload} className="mb-3" />
      <Card pad={false}>
        {loading && !data ? <Spinner /> : (
          <DataTable
            rows={data || []}
            rowKey={(r) => r.request_id}
            empty={<EmptyState title="No requests" hint={status === 'Pending' ? 'Nothing is waiting for a decision.' : undefined} />}
            columns={[
              { key: 'project', header: 'Project', render: (r) => <Link className="font-medium text-navy-700 hover:underline" to={`/officer/projects/${r.project_id}`}>{r.project_name}<div className="text-xs font-normal text-slate-500">{r.project_code}</div></Link> },
              { key: 'request_type', header: 'Type' },
              { key: 'ask', header: 'Requested', render: (r) => r.request_type === 'Extension' ? `New deadline ${fmtDate(r.requested_deadline)}` : `Revised amount ${inr(r.requested_amount)}` },
              { key: 'justification', header: 'Justification', render: (r) => <div className="max-w-sm text-sm">{r.justification}</div> },
              { key: 'status', header: 'Status', render: (r) => <><StatusBadge status={r.status} />{r.decision_note && <div className="mt-1 max-w-xs text-xs text-slate-500">{r.decision_note}</div>}</> },
              { key: 'created_at', header: 'Submitted', render: (r) => fmtDate(r.created_at) },
              { key: 'act', header: '', render: (r) => r.status === 'Pending' && (
                <div className="flex gap-1.5">
                  <button className="btn-success btn-sm" onClick={() => open(r, 'Approve')}><Check className="h-3.5 w-3.5" /> Approve</button>
                  <button className="btn-danger btn-sm" onClick={() => open(r, 'Reject')}><X className="h-3.5 w-3.5" /> Reject</button>
                </div>) },
            ]}
          />
        )}
      </Card>

      <ConfirmDialog open={!!target} busy={busy} tone={target?.decision === 'Approve' ? 'success' : 'danger'}
        title={`${target?.decision} ${target?.request.request_type.toLowerCase()} request?`} confirmLabel={target?.decision}
        message={target && `${target.request.project_code}: ${target.request.request_type === 'Extension' ? `deadline ${fmtDate(target.request.requested_deadline)}` : `sanctioned amount ${inr(target.request.requested_amount)}`}. ${target.decision === 'Approve' ? 'Approving updates the project record.' : ''}`}
        onCancel={() => setTarget(null)} onConfirm={() => note.trim().length >= 3 ? submit() : setErr(new Error('Please enter a decision note (at least 3 characters).'))}>
        <div className="mt-3 space-y-3">
          <ErrorBanner error={err} />
          <Field label="Decision note" required><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </ConfirmDialog>
    </>
  )
}
