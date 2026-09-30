import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDate, fmtDateTime } from '../../lib/format'
import {
  Card, DataTable, EmptyState, ErrorBanner, Field, KeyValue, Modal, Notice, PageHeader, Pill, Spinner, StatusBadge, Textarea,
  useAction, useApi, useToast,
} from '../../components/ui'
import EvidenceGallery from '../../components/portal/EvidenceGallery'

const FILTERS = ['', 'Assigned', 'Under Investigation', 'Resolved', 'Closed']
const OPEN = ['Assigned', 'Under Investigation']

export default function AgencyComplaints() {
  const toast = useToast()
  const [status, setStatus] = useState('')
  const [sel, setSel] = useState(null)
  const [text, setText] = useState('')
  const { data, loading, error, reload } = useApi(() => api.get('/api/complaints', { status, page_size: 100 }), [status])
  const rows = data?.items || []

  const [respond, { busy, error: respErr, setError }] = useAction(async () => {
    const updated = await api.put(`/api/complaints/${sel.complaint_id}`, { action: 'respond', text: text.trim() })
    toast('Your response was sent to the officer.')
    setSel(updated); setText('')
    reload()
  })
  const open = (r) => { setSel(r); setText(''); setError(null) }

  return (
    <>
      <PageHeader title="Complaints" subtitle="Verified citizen complaints about your projects. Citizen identities are never shown to agencies." />
      <Notice className="mb-4">You can respond to a complaint, but you cannot edit, delete or close it - the officer reviews your response and records the resolution.</Notice>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => <button key={f || 'all'} onClick={() => setStatus(f)} className={`pill ${status === f ? 'bg-navy-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{f || 'All'}</button>)}
      </div>
      <ErrorBanner error={error} onRetry={reload} className="mb-4" />
      {loading && !data ? <Spinner /> : (
        <DataTable rows={rows} rowKey={(r) => r.complaint_id} onRowClick={open}
          empty={<Card><EmptyState title="No complaints found" hint="Verified complaints assigned to your projects will appear here." /></Card>}
          columns={[
            { key: 'tracking_id', header: 'Tracking ID', render: (r) => <span className="font-mono text-xs font-semibold">{r.tracking_id}</span> },
            { key: 'project', header: 'Project', render: (r) => <div><div className="font-medium text-slate-800">{r.project_name}</div><div className="text-xs text-slate-400">{r.project_code}</div></div> },
            { key: 'category', header: 'Category', render: (r) => <div className="flex flex-wrap items-center gap-1">{r.category}{r.serious && <Pill tone="red"><AlertTriangle className="h-3 w-3" /> Serious</Pill>}</div> },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'response', header: 'Your response', render: (r) => (r.response ? <span className="text-green-700">Sent {fmtDate(r.responded_at)}</span> : (OPEN.includes(r.status) ? <span className="text-orange-700">Response needed</span> : '—')) },
            { key: 'created_at', header: 'Received', render: (r) => fmtDate(r.created_at) },
          ]} />
      )}

      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? `Complaint ${sel.tracking_id}` : ''} size="lg"
        footer={sel && OPEN.includes(sel.status)
          ? <><button className="btn-secondary" onClick={() => setSel(null)}>Close</button><button className="btn-primary" disabled={busy || text.trim().length < 10} onClick={respond}>{busy ? 'Sending…' : sel.response ? 'Send updated response' : 'Send response'}</button></>
          : <button className="btn-secondary" onClick={() => setSel(null)}>Close</button>}>
        {sel && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={sel.status} />{sel.serious && <Pill tone="red">Serious complaint</Pill>}</div>
            <KeyValue items={[['Project', `${sel.project_name} (${sel.project_code})`], ['Category', sel.category], ['Received', fmtDateTime(sel.created_at)], ['Incident date', fmtDate(sel.incident_date)], ['Location', sel.location_text]]} />
            <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Complaint</div><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{sel.description}</p></div>
            <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Attachments</div><EvidenceGallery evidence={sel.evidence} /></div>
            {sel.response && <div className="rounded-md bg-green-50 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-green-700">Your response ({fmtDateTime(sel.responded_at)})</div><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{sel.response}</p></div>}
            {OPEN.includes(sel.status) ? (
              <div>
                <ErrorBanner error={respErr} className="mb-3" />
                <Field label={sel.response ? 'Add an updated response' : 'Your response'} required hint={`${text.trim().length} characters (minimum 10). Describe the action taken or planned.`}>
                  <Textarea rows={4} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
                </Field>
              </div>
            ) : <Notice>This complaint is <b>{sel.status}</b> - no further response is needed.</Notice>}
          </div>
        )}
      </Modal>
    </>
  )
}
