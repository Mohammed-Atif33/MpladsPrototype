import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ExternalLink, Star } from 'lucide-react'
import clsx from 'clsx'
import { api, openProtectedFile } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { ROLE, useBasePath } from '../../lib/nav'
import { fmtDate, fmtDateTime } from '../../lib/format'
import {
  AuthImage, Card, Checkbox, ConfirmDialog, DataTable, EmptyState, ErrorBanner, Field, KeyValue, Modal, Notice, PageHeader, Pill, SearchBox, Select,
  Spinner, StatusBadge, Textarea, useApi, useDebounced, useToast,
} from '../../components/ui'

const TL_TONE = (t) => (t.done ? 'bg-green-500' : t.current ? 'bg-navy-600' : 'bg-slate-300')

function Timeline({ items }) {
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-2">
      {items.map((t) => (
        <li key={t.step} className="flex items-center gap-1.5 text-xs"><span className={clsx('h-2.5 w-2.5 rounded-full', TL_TONE(t))} /><span className={clsx(t.current ? 'font-semibold text-slate-900' : 'text-slate-500')}>{t.step}</span></li>
      ))}
    </ol>
  )
}

const ACTION_COPY = {
  screen: { title: 'Screen complaint', confirm: 'Save screening result' },
  investigate: { title: 'Move to investigation', confirm: 'Mark under investigation' },
  resolve: { title: 'Resolve complaint', confirm: 'Record resolution' },
  close: { title: 'Close complaint', confirm: 'Close complaint' },
  decide_appeal: { title: 'Decide appeal', confirm: 'Record appeal decision' },
}

export default function ReviewComplaints() {
  const { user } = useAuth()
  const base = useBasePath()
  const toast = useToast()
  const isHead = user.role === ROLE.HEAD

  const [status, setStatus] = useState('')
  const [screening, setScreening] = useState('')
  const [serious, setSerious] = useState('')
  const [appeal, setAppeal] = useState(isHead ? 'Pending' : '')
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 350)
  const { data, loading, error, reload } = useApi(() => api.get('/api/complaints', {
    status, screening_status: screening, serious, appeal_status: appeal, q: dq, page_size: 100,
  }), [status, screening, serious, appeal, dq])

  const [sel, setSel] = useState(null)         // selected complaint
  const [action, setAction] = useState(null)   // { key }
  const [f, setF] = useState({ verdict: '', serious: false, note: '', text: '', outcome: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const items = data?.items || []
  const clearFilters = () => { setStatus(''); setScreening(''); setSerious(''); setAppeal(''); setQ('') }
  const anyFilter = status || screening || serious || appeal || q

  const startAction = (key) => {
    setErr(null)
    setF({ verdict: '', serious: !!sel.serious, note: '', text: '', outcome: '' })
    setAction({ key })
  }

  const validate = () => {
    const k = action.key
    if (k === 'screen') { if (!f.verdict) return 'Choose verified or rejected.'; if (f.note.trim().length < 5) return 'Add a screening note (at least 5 characters).' }
    if (k === 'resolve' && f.text.trim().length < 10) return 'Enter the resolution details (at least 10 characters).'
    if (k === 'decide_appeal') { if (!f.outcome) return 'Choose to uphold or reject the appeal.'; if (f.note.trim().length < 5) return 'Add a note explaining the decision.' }
    return ''
  }

  const submit = async () => {
    const v = validate()
    if (v) return setErr(new Error(v))
    setBusy(true); setErr(null)
    const k = action.key
    const body = { action: k }
    if (k === 'screen') Object.assign(body, { verdict: f.verdict, serious: f.serious, note: f.note.trim() })
    if (k === 'investigate' || k === 'close') body.note = f.note.trim() || undefined
    if (k === 'resolve') body.text = f.text.trim()
    if (k === 'decide_appeal') Object.assign(body, { outcome: f.outcome, note: f.note.trim() })
    try {
      const updated = await api.put(`/api/complaints/${sel.complaint_id}`, body)
      toast(`${ACTION_COPY[k].title}: done. The audit trail was updated and the citizen/agency were notified where relevant.`)
      setSel(updated); setAction(null); reload()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  // which actions are valid for the selected complaint + role
  const actionsFor = (c) => {
    const a = []
    if (c.screening_status === 'Pending' && c.status === 'Submitted') a.push(['screen', 'Screen complaint', 'btn-primary'])
    if (c.screening_status === 'Verified' && c.status === 'Assigned') a.push(['investigate', 'Move to investigation', 'btn-secondary'])
    if (c.screening_status === 'Verified' && ['Assigned', 'Under Investigation'].includes(c.status)) a.push(['resolve', 'Resolve', 'btn-success'])
    if (['Resolved', 'Rejected'].includes(c.status) && c.appeal_status !== 'Pending') a.push(['close', 'Close complaint', 'btn-secondary'])
    if (isHead && c.status === 'Appealed' && c.appeal_status === 'Pending') a.push(['decide_appeal', 'Decide appeal', 'btn-warn'])
    return a
  }

  return (
    <>
      <PageHeader title={isHead ? 'Complaints & Appeals' : 'Complaints'} subtitle="Screen citizen complaints, follow the agency response and resolve them. Only verified complaints carry weight in risk analysis." />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SearchBox className="lg:col-span-1" value={q} onChange={setQ} placeholder="Tracking ID, text…" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{['Submitted', 'Assigned', 'Under Investigation', 'Resolved', 'Closed', 'Appealed', 'Rejected'].map((s) => <option key={s}>{s}</option>)}</Select>
          <Select value={screening} onChange={(e) => setScreening(e.target.value)}><option value="">Any screening</option><option value="Pending">Awaiting screening</option><option value="Verified">Verified</option><option value="Rejected">Rejected</option></Select>
          <Select value={serious} onChange={(e) => setSerious(e.target.value)}><option value="">Serious or not</option><option value="true">Serious only</option><option value="false">Not serious</option></Select>
          <Select value={appeal} onChange={(e) => setAppeal(e.target.value)}><option value="">Any appeal state</option><option value="Pending">Pending appeals</option><option value="Upheld">Upheld</option><option value="Rejected">Appeal rejected</option></Select>
        </div>
        {anyFilter && <button className="btn-ghost btn-sm mt-2" onClick={clearFilters}>Clear filters</button>}
      </Card>

      <ErrorBanner error={error} onRetry={reload} className="mb-3" />
      <Card pad={false}>
        {loading && !data ? <Spinner /> : (
          <DataTable
            rows={items}
            rowKey={(r) => r.complaint_id}
            onRowClick={(r) => { setSel(r); setAction(null); setErr(null) }}
            empty={<EmptyState title={appeal === 'Pending' && !status && !screening && !serious && !q ? 'No pending appeals' : 'No complaints match'} hint={anyFilter ? 'Clear the filters to see all complaints.' : undefined}
              action={anyFilter ? <button className="btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button> : undefined} />}
            columns={[
              { key: 'tracking_id', header: 'Tracking ID', render: (r) => <span className="font-mono text-xs">{r.tracking_id}</span> },
              { key: 'category', header: 'Complaint', render: (r) => <div className="max-w-md"><div className="font-medium">{r.category}{r.serious && <span className="ml-2 pill bg-red-100 text-red-800"><AlertTriangle className="h-3 w-3" /> serious</span>}</div><div className="line-clamp-2 text-xs text-slate-600">{r.description}</div></div> },
              { key: 'project', header: 'Project', render: (r) => <span className="text-xs">{r.project_name || '—'}<div className="text-slate-400">{r.project_code}</div></span> },
              { key: 'citizen', header: 'Citizen', render: (r) => <span className="text-xs">{r.citizen}</span> },
              { key: 'screening', header: 'Screening', render: (r) => <StatusBadge status={r.screening_status} /> },
              { key: 'status', header: 'Status', render: (r) => <><StatusBadge status={r.status} />{r.appeal_status === 'Pending' && <div><Pill tone="purple" className="mt-1">appeal pending</Pill></div>}</> },
              { key: 'created_at', header: 'Filed', render: (r) => fmtDate(r.created_at) },
            ]}
          />
        )}
      </Card>

      {/* detail panel */}
      <Modal open={!!sel} onClose={() => { setSel(null); setAction(null) }} size="lg" title={sel ? `Complaint ${sel.tracking_id}` : ''}
        footer={sel && actionsFor(sel).length > 0 ? actionsFor(sel).map(([k, label, cls]) => <button key={k} className={cls} onClick={() => startAction(k)}>{label}</button>) : undefined}>
        {sel && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={sel.status} />
              {sel.serious && <Pill tone="red"><AlertTriangle className="h-3 w-3" /> serious</Pill>}
              <StatusBadge status={sel.screening_status} className="ring-1 ring-slate-200" />
              <span className="text-xs text-slate-500">Screening: {sel.screening_status}</span>
            </div>
            <Timeline items={sel.timeline || []} />
            <KeyValue items={[
              ['Category', sel.category], ['Project', sel.project_id ? <Link className="text-navy-700 underline" to={`${base}/projects/${sel.project_id}`}>{sel.project_name} ({sel.project_code})</Link> : `${sel.project_code} (not yet stored)`],
              ['Citizen', sel.citizen], ['Filed', fmtDateTime(sel.created_at)], ['Incident date', fmtDate(sel.incident_date)], ['Location', sel.location_text],
            ]} />
            <div><div className="label">Description</div><p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-800">{sel.description}</p></div>

            {(sel.evidence || []).length > 0 && (
              <div>
                <div className="label">Evidence</div>
                <div className="flex flex-wrap gap-3">
                  {sel.evidence.map((e) => (e.content_type || '').startsWith('image/')
                    ? <button key={e.document_id} type="button" onClick={() => openProtectedFile(`/api/documents/${e.document_id}/file`)}><AuthImage documentId={e.document_id} alt={e.file_name} className="h-28 w-40 rounded-md border border-slate-200 object-cover" /></button>
                    : <button key={e.document_id} className="btn-secondary btn-sm" onClick={() => openProtectedFile(`/api/documents/${e.document_id}/file`)}><ExternalLink className="h-3.5 w-3.5" /> {e.file_name}</button>)}
                </div>
              </div>
            )}

            {sel.screening_note && <div><div className="label">Screening note <span className="font-normal text-slate-400">(internal - never shown to citizens or agencies)</span></div><p className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm">{sel.screening_note}</p></div>}
            {sel.response && <div><div className="label">Agency response {sel.responded_at && <span className="font-normal text-slate-400">· {fmtDateTime(sel.responded_at)}</span>}</div><p className="rounded-md bg-slate-50 p-3 text-sm">{sel.response}</p></div>}
            {sel.resolution && <div><div className="label">Resolution</div><p className="rounded-md bg-green-50 p-3 text-sm">{sel.resolution}</p></div>}
            {sel.feedback_satisfied !== null && sel.feedback_satisfied !== undefined && (
              <div><div className="label">Citizen feedback</div>
                <div className="rounded-md bg-slate-50 p-3 text-sm">
                  <div className="flex items-center gap-2"><Pill tone={sel.feedback_satisfied ? 'green' : 'orange'}>{sel.feedback_satisfied ? 'Satisfied' : 'Not satisfied'}</Pill>
                    {sel.feedback_rating && <span className="flex">{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={clsx('h-3.5 w-3.5', n <= sel.feedback_rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />)}</span>}</div>
                  {sel.feedback_comment && <p className="mt-1">{sel.feedback_comment}</p>}
                </div>
              </div>
            )}
            {sel.appeal && (
              <div><div className="label">Citizen appeal <StatusBadge status={sel.appeal_status} /></div>
                <p className="rounded-md border border-purple-200 bg-purple-50 p-3 text-sm">{sel.appeal}</p>
                {sel.appeal_decision_note && <p className="mt-1 text-sm text-slate-600"><b>Decision note:</b> {sel.appeal_decision_note}</p>}
              </div>
            )}
            {actionsFor(sel).length === 0 && <Notice>No action is required from you on this complaint right now.</Notice>}
          </div>
        )}
      </Modal>

      {/* action forms */}
      <ConfirmDialog open={!!action} busy={busy} title={action ? ACTION_COPY[action.key].title : ''} confirmLabel={action ? ACTION_COPY[action.key].confirm : ''}
        tone={action?.key === 'decide_appeal' ? 'warn' : action?.key === 'resolve' ? 'success' : 'primary'}
        onCancel={() => setAction(null)} onConfirm={submit}>
        {action && sel && (
          <div className="mt-2 space-y-3">
            <ErrorBanner error={err} />
            {action.key === 'screen' && <>
              <Field label="Screening result" required>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" name="verdict" checked={f.verdict === 'verified'} onChange={() => setF({ ...f, verdict: 'verified' })} /> Verified - assign to agency</label>
                  <label className="flex items-center gap-1.5"><input type="radio" name="verdict" checked={f.verdict === 'rejected'} onChange={() => setF({ ...f, verdict: 'rejected' })} /> Not verified - reject</label>
                </div>
              </Field>
              <Checkbox checked={f.serious} onChange={(v) => setF({ ...f, serious: v })} label="Mark as serious" hint="Serious complaints also notify the Head Officer" />
              <Field label="Screening note (internal)" required><Textarea rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            </>}
            {(action.key === 'investigate' || action.key === 'close') && <Field label="Note (optional)"><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>}
            {action.key === 'resolve' && <Field label="Resolution details" required hint="Shown to the citizen, who can then give feedback or appeal."><Textarea rows={4} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>}
            {action.key === 'decide_appeal' && <>
              <Field label="Appeal decision" required>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" name="outcome" checked={f.outcome === 'uphold'} onChange={() => setF({ ...f, outcome: 'uphold' })} /> Uphold - reopen the complaint</label>
                  <label className="flex items-center gap-1.5"><input type="radio" name="outcome" checked={f.outcome === 'reject'} onChange={() => setF({ ...f, outcome: 'reject' })} /> Reject - close</label>
                </div>
              </Field>
              <Field label="Decision note" required><Textarea rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            </>}
          </div>
        )}
      </ConfirmDialog>
    </>
  )
}
