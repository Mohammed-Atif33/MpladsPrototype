import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ExternalLink, Plus, Upload } from 'lucide-react'
import { api, openProtectedFile } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { ROLE, useBasePath } from '../../lib/nav'
import { fmtDate } from '../../lib/format'
import {
  AuthImage, Card, Checkbox, ConfirmDialog, DataTable, EmptyState, ErrorBanner, Field, FileInput, Input, KeyValue, Modal, Notice, PageHeader, Pill,
  PriorityBadge, Select, Spinner, StatusBadge, Textarea, useApi, useToast,
} from '../../components/ui'
import { INSPECTION_STEPS, Stepper } from '../../components/officer/common'

const OPEN = ['Requested', 'Assigned', 'Scheduled', 'Completed']
const today = () => new Date().toISOString().slice(0, 10)
const isOverdue = (i) => i.due_date && OPEN.includes(i.status) && i.due_date < today()

export default function Inspections() {
  const { user } = useAuth()
  const base = useBasePath()
  const toast = useToast()
  const isHead = user.role === ROLE.HEAD
  const isOfficer = user.role === ROLE.OFFICER

  const [status, setStatus] = useState('')
  const [mine, setMine] = useState(false)
  const { data, loading, error, reload } = useApi(() => api.get('/api/inspections', { status, mine: mine || undefined }), [status, mine])
  const meta = useApi(() => api.get('/api/meta'), [])
  const inspectors = useApi(() => api.get('/api/users/inspectors'), [], { enabled: isHead })

  const [sel, setSel] = useState(null)
  const [act, setAct] = useState(null) // action key being confirmed
  const [f, setF] = useState({})
  const [file, setFile] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [reqOpen, setReqOpen] = useState(false)
  const [rf, setRf] = useState({ project_id: '', reason: '', priority: 'Medium' })
  const projects = useApi(() => api.get('/api/projects', { page_size: 100, sort: 'name' }), [], { enabled: reqOpen })

  const rows = data || []
  const overdueCount = rows.filter(isOverdue).length
  const isAssignee = (i) => i.assigned_to_id === user.user_id

  const open = (i) => { setSel(i); setAct(null); setErr(null); setFile([]) }
  const refreshSel = async (id) => { const fresh = await api.get(`/api/inspections/${id}`); setSel(fresh); reload() }

  const actionsFor = (i) => {
    const a = []
    if (isHead && ['Requested', 'Assigned'].includes(i.status)) a.push(['assign', i.status === 'Requested' ? 'Assign inspector' : 'Re-assign', 'btn-primary'])
    if ((isAssignee(i) || isHead) && i.status === 'Assigned') a.push(['schedule', 'Schedule inspection', 'btn-primary'])
    if (isAssignee(i) && i.status === 'Scheduled') a.push(['complete', 'Mark completed', 'btn-success'])
    if (isAssignee(i) && i.status === 'Completed') a.push(['submit_report', 'Submit report', 'btn-primary'])
    if (i.status === 'Report Submitted' && (isOfficer || isHead)) a.push(['action_pending', 'Move to action pending', 'btn-secondary'])
    if (i.status === 'Action Pending' && (isOfficer || isHead || user.role === ROLE.AGENCY)) a.push(['record_action', 'Record action taken', 'btn-primary'])
    if (['Report Submitted', 'Action Pending'].includes(i.status) && (isOfficer || isHead)) a.push(['close', 'Close inspection', 'btn-secondary'])
    return a
  }
  const TITLES = {
    assign: 'Assign inspector',
    schedule: 'Schedule inspection',
    complete: 'Mark inspection completed',
    submit_report: 'Submit inspection report',
    action_pending: 'Move to action pending',
    record_action: 'Record action taken',
    close: 'Close inspection'
  }

  const startAct = (k) => {
    setErr(null)
    setF({
      inspector_id: sel.assigned_to_id || '',
      due_date: sel.due_date || '',
      priority: sel.priority,
      scheduled_date: sel.scheduled_date || '',
      findings: sel.findings || '',
      recommendation: sel.recommendation || '',
      outcome: sel.outcome || '',
      note: '',
      progress_observed: sel.progress_observed ?? '',
      issues: sel.issues || '',
      action_required: sel.action_required || '',
      responsible_party: sel.responsible_party || '',
      action_taken: sel.action_taken || '',
      closure_reason: sel.closure_reason || '',
    })
    setAct(k)
  }
  const validate = () => {
    if (act === 'assign' && !f.inspector_id) return 'Select an inspector.'
    if (act === 'schedule' && !f.scheduled_date) return 'Choose the inspection date.'
    if (act === 'submit_report') {
      if ((f.findings || '').trim().length < 10) return 'Enter the findings (at least 10 characters).'
      if (!f.recommendation?.trim()) return 'Enter a recommendation.'
      if (!f.outcome) return 'Select the outcome.'
    }
    if (act === 'record_action' && !f.action_taken?.trim()) {
      return 'Enter the action taken details.'
    }
    return ''
  }
  const submit = async () => {
    const v = validate()
    if (v) return setErr(new Error(v))
    setBusy(true); setErr(null)
    const body = { action: act }
    if (act === 'assign') Object.assign(body, { inspector_id: Number(f.inspector_id), due_date: f.due_date || undefined, priority: f.priority })
    if (act === 'schedule') body.scheduled_date = f.scheduled_date
    if (act === 'submit_report') {
      Object.assign(body, {
        findings: f.findings.trim(),
        recommendation: f.recommendation.trim(),
        outcome: f.outcome,
        progress_observed: f.progress_observed !== '' && f.progress_observed !== undefined ? Number(f.progress_observed) : undefined,
        issues: f.issues?.trim() || undefined,
        action_required: f.action_required?.trim() || undefined,
        responsible_party: f.responsible_party?.trim() || undefined,
      })
    }
    if (act === 'action_pending') {
      Object.assign(body, {
        action_required: f.action_required?.trim() || undefined,
        responsible_party: f.responsible_party?.trim() || undefined,
        note: f.note?.trim() || undefined,
      })
    }
    if (act === 'record_action') {
      Object.assign(body, {
        action_taken: f.action_taken?.trim(),
      })
    }
    if (act === 'close') {
      Object.assign(body, {
        closure_reason: f.closure_reason?.trim() || f.note?.trim() || undefined,
        action_taken: f.action_taken?.trim() || undefined,
        note: f.note?.trim() || undefined,
      })
    }
    if (f.note?.trim() && act === 'complete') body.note = f.note.trim()
    try {
      const updated = await api.put(`/api/inspections/${sel.inspection_id}`, body)
      toast(`${TITLES[act]}: done.`)
      setSel(updated); setAct(null); reload()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  const upload = async () => {
    if (!file[0]) return
    setBusy(true); setErr(null)
    try {
      const form = new FormData()
      form.append('file', file[0])
      await api.upload(`/api/inspections/${sel.inspection_id}/evidence`, form)
      toast('Evidence uploaded.'); setFile([]); await refreshSel(sel.inspection_id)
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  const createReq = async () => {
    setBusy(true); setErr(null)
    try {
      await api.post('/api/inspections', { project_id: Number(rf.project_id), reason: rf.reason.trim(), priority: rf.priority })
      toast('Inspection requested. The Head Officer has been notified to assign an inspector.')
      setReqOpen(false); setRf({ project_id: '', reason: '', priority: 'Medium' }); reload()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  const outcomes = meta.data?.inspection_outcomes || ['Satisfactory', 'Minor Deficiencies', 'Major Deficiencies', 'Irregularities Found']
  const canReq = isOfficer

  return (
    <>
      <PageHeader title="Inspections" subtitle="Requested → Assigned → Scheduled → Completed → Report Submitted → Action Pending → Closed"
        actions={canReq && <button className="btn-primary" onClick={() => { setErr(null); setReqOpen(true) }}><Plus className="h-4 w-4" /> Request inspection</button>} />

      {overdueCount > 0 && <Notice tone="red" className="mb-4"><b>{overdueCount} inspection(s) are overdue.</b> {isHead ? 'Use “Run scheduled supervisory checks” on the dashboard to raise the overdue notifications.' : 'The Head Officer has been alerted.'}</Notice>}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select className="!w-52" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{INSPECTION_STEPS.map((s) => <option key={s}>{s}</option>)}</Select>
        <Checkbox checked={mine} onChange={setMine} label="Assigned to me" />
      </div>
      <ErrorBanner error={error} onRetry={reload} className="mb-3" />
      <Card pad={false}>
        {loading && !data ? <Spinner /> : (
          <DataTable rows={rows} rowKey={(r) => r.inspection_id} onRowClick={open}
            empty={<EmptyState title="No inspections" hint={mine ? 'Nothing is assigned to you.' : undefined} />}
            columns={[
              { key: 'id', header: '#', render: (r) => `#${r.inspection_id}` },
              { key: 'project', header: 'Project', render: (r) => <span className="font-medium">{r.project_name}<div className="text-xs font-normal text-slate-500">{r.project_code}</div></span> },
              { key: 'reason', header: 'Reason', render: (r) => <span className="line-clamp-2 max-w-xs text-xs">{r.reason}</span> },
              { key: 'priority', header: 'Priority', render: (r) => <PriorityBadge priority={r.priority} /> },
              { key: 'status', header: 'Progress', render: (r) => <div className="space-y-1.5"><StatusBadge status={r.status} /><Stepper status={r.status} compact /></div> },
              { key: 'assigned_to', header: 'Inspector', render: (r) => r.assigned_to || <span className="text-slate-400">unassigned</span> },
              { key: 'due', header: 'Due', render: (r) => <span className="whitespace-nowrap">{fmtDate(r.due_date)}{isOverdue(r) && <Pill tone="red" className="ml-1.5"><AlertTriangle className="h-3 w-3" /> overdue</Pill>}</span> },
            ]} />
        )}
      </Card>

      {/* detail */}
      <Modal open={!!sel} onClose={() => { setSel(null); setAct(null) }} size="lg" title={sel ? `Inspection #${sel.inspection_id} · ${sel.project_code}` : ''}
        footer={sel && actionsFor(sel).length > 0 ? actionsFor(sel).map(([k, label, cls]) => <button key={k} className={cls} onClick={() => startAct(k)}>{label}</button>) : undefined}>
        {sel && (
          <div className="space-y-4">
            <Stepper status={sel.status} />
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={sel.status} /><PriorityBadge priority={sel.priority} />{isOverdue(sel) && <Pill tone="red"><AlertTriangle className="h-3 w-3" /> overdue since {fmtDate(sel.due_date)}</Pill>}</div>
            <KeyValue items={[
              ['Project', <Link className="text-navy-700 underline" to={`${base}/projects/${sel.project_id}`}>{sel.project_name}</Link>], ['Requested by', sel.requested_by],
              ['Inspector', sel.assigned_to || 'Not assigned'], ['Requested', fmtDate(sel.requested_at)], ['Scheduled for', fmtDate(sel.scheduled_date)], ['Due', fmtDate(sel.due_date)],
              sel.completed_at ? ['Completed on', fmtDate(sel.completed_at)] : null,
              sel.progress_observed != null ? ['Observed progress', `${sel.progress_observed}%`] : null,
            ].filter(Boolean)} />
            <div><div className="label">Reason</div><p className="rounded-md bg-slate-50 p-3 text-sm">{sel.reason}</p></div>
            {sel.findings && <div><div className="label">Findings</div><p className="rounded-md bg-slate-50 p-3 text-sm">{sel.findings}</p></div>}
            {sel.issues && <div><div className="label">Issues Identified</div><p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{sel.issues}</p></div>}
            {sel.recommendation && <div><div className="label">Recommendation</div><p className="rounded-md bg-slate-50 p-3 text-sm">{sel.recommendation}</p></div>}
            {sel.outcome && <div><div className="label">Outcome</div><Pill tone={['Major Deficiencies', 'Irregularities Found'].includes(sel.outcome) ? 'red' : sel.outcome === 'Minor Deficiencies' ? 'yellow' : 'green'}>{sel.outcome}</Pill></div>}

            {sel.action_required && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <div className="font-semibold text-amber-900">Action Required</div>
                <div className="mt-1 text-amber-800">{sel.action_required}</div>
                {sel.responsible_party && <div className="mt-1 text-xs text-amber-700"><b>Responsible:</b> {sel.responsible_party}</div>}
              </div>
            )}

            {sel.action_taken && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <div className="font-semibold text-emerald-900">Action Taken</div>
                <div className="mt-1 text-emerald-800">{sel.action_taken}</div>
                {sel.action_date && <div className="mt-1 text-xs text-emerald-700">Recorded on {fmtDate(sel.action_date)}</div>}
              </div>
            )}

            {sel.closure_reason && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="font-semibold text-slate-900">Closure Reason</div>
                <div className="mt-1 text-slate-700">{sel.closure_reason}</div>
              </div>
            )}

            <div>
              <div className="label">Evidence photos / documents</div>
              {(sel.evidence || []).length === 0 ? <p className="text-sm text-slate-500">No evidence attached.</p> : (
                <div className="flex flex-wrap gap-3">
                  {sel.evidence.map((e) => (e.content_type || '').startsWith('image/')
                    ? <button key={e.document_id} type="button" onClick={() => openProtectedFile(`/api/documents/${e.document_id}/file`)}><AuthImage documentId={e.document_id} alt={e.file_name} className="h-24 w-36 rounded-md border border-slate-200 object-cover" /></button>
                    : <button key={e.document_id} className="btn-secondary btn-sm" onClick={() => openProtectedFile(`/api/documents/${e.document_id}/file`)}><ExternalLink className="h-3.5 w-3.5" /> {e.file_name}</button>)}
                </div>
              )}
              {isAssignee(sel) && sel.status !== 'Closed' && (
                <div className="mt-3 flex flex-wrap items-start gap-3">
                  <FileInput files={file} onChange={setFile} accept="image/*,application/pdf" label="Choose photo / PDF" />
                  <button className="btn-secondary btn-sm" disabled={!file[0] || busy} onClick={upload}><Upload className="h-3.5 w-3.5" /> Upload evidence</button>
                </div>
              )}
            </div>
            {!act && <ErrorBanner error={err} />}
            {actionsFor(sel).length === 0 && <Notice>{sel.status === 'Closed' ? 'This inspection is closed.' : 'No action is required from you on this inspection right now.'}</Notice>}
          </div>
        )}
      </Modal>

      {/* action forms */}
      <ConfirmDialog open={!!act} busy={busy} title={act ? TITLES[act] : ''} confirmLabel="Confirm" onCancel={() => setAct(null)} onConfirm={submit}>
        {act && (
          <div className="mt-2 space-y-3">
            <ErrorBanner error={err} />
            {act === 'assign' && <>
              <Field label="Inspector" required><Select value={f.inspector_id} onChange={(e) => setF({ ...f, inspector_id: e.target.value })}><option value="">Select…</option>{(inspectors.data || []).map((i) => <option key={i.user_id} value={i.user_id}>{i.name}{i.department ? ` · ${i.department}` : ''}</option>)}</Select></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Due by"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
                <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{['Low', 'Medium', 'High', 'Urgent'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
              </div>
            </>}
            {act === 'schedule' && <Field label="Inspection date" required><Input type="date" value={f.scheduled_date} onChange={(e) => setF({ ...f, scheduled_date: e.target.value })} /></Field>}
            {act === 'submit_report' && <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Outcome" required>
                  <Select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>
                    <option value="">Select…</option>
                    {outcomes.map((o) => <option key={o}>{o}</option>)}
                  </Select>
                </Field>
                <Field label="Observed Physical Progress (%)">
                  <Input type="number" min="0" max="100" placeholder="e.g. 65" value={f.progress_observed} onChange={(e) => setF({ ...f, progress_observed: e.target.value })} />
                </Field>
              </div>
              <Field label="Findings" required><Textarea rows={4} value={f.findings} onChange={(e) => setF({ ...f, findings: e.target.value })} placeholder="Detailed physical observations on site..." /></Field>
              <Field label="Issues / Deficiencies (optional)"><Textarea rows={2} value={f.issues} onChange={(e) => setF({ ...f, issues: e.target.value })} placeholder="Any quality, material or delay issues detected..." /></Field>
              <Field label="Recommendation" required><Textarea rows={2} value={f.recommendation} onChange={(e) => setF({ ...f, recommendation: e.target.value })} placeholder="Actionable recommendations for the District Authority..." /></Field>
              <div className="border-t border-slate-200 pt-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Follow-up Action (Optional - triggers Action Pending)</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Action Required from Agency">
                    <Input value={f.action_required} onChange={(e) => setF({ ...f, action_required: e.target.value })} placeholder="e.g. Rectify boundary wall crack" />
                  </Field>
                  <Field label="Responsible Party">
                    <Input value={f.responsible_party} onChange={(e) => setF({ ...f, responsible_party: e.target.value })} placeholder="e.g. Executing Agency" />
                  </Field>
                </div>
              </div>
            </>}
            {act === 'action_pending' && <>
              <Field label="Action Required from Agency" required><Textarea rows={2} value={f.action_required} onChange={(e) => setF({ ...f, action_required: e.target.value })} placeholder="Specify required corrective action..." /></Field>
              <Field label="Responsible Party"><Input value={f.responsible_party} onChange={(e) => setF({ ...f, responsible_party: e.target.value })} placeholder="e.g. Implementing Agency" /></Field>
              <Field label="Internal Note (optional)"><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            </>}
            {act === 'record_action' && <>
              <Field label="Action Taken Description" required><Textarea rows={3} value={f.action_taken} onChange={(e) => setF({ ...f, action_taken: e.target.value })} placeholder="Describe what rectification or remediation steps were performed..." /></Field>
            </>}
            {act === 'close' && <>
              <Field label="Closure Reason / Summary" hint="Reason for concluding this inspection"><Textarea rows={2} value={f.closure_reason} onChange={(e) => setF({ ...f, closure_reason: e.target.value })} placeholder="e.g. Rectification verified and accepted by District Authority" /></Field>
              {!sel.action_taken && <Field label="Action Taken (if any)"><Textarea rows={2} value={f.action_taken} onChange={(e) => setF({ ...f, action_taken: e.target.value })} placeholder="Describe resolution achieved..." /></Field>}
              <Field label="Internal Note (optional)"><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            </>}
            {act === 'complete' && <Field label="Note (optional)"><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>}
          </div>
        )}
      </ConfirmDialog>

      {/* request */}
      <Modal open={reqOpen} onClose={() => setReqOpen(false)} title="Request an inspection"
        footer={<><button className="btn-secondary" onClick={() => setReqOpen(false)}>Cancel</button>
          <button className="btn-primary" disabled={busy || !rf.project_id || rf.reason.trim().length < 10} onClick={createReq}>{busy ? 'Submitting…' : 'Request inspection'}</button></>}>
        <div className="space-y-3">
          <ErrorBanner error={reqOpen ? err : null} />
          <Field label="Project" required>
            <Select value={rf.project_id} onChange={(e) => setRf({ ...rf, project_id: e.target.value })}>
              <option value="">{projects.loading ? 'Loading…' : 'Select project…'}</option>
              {(projects.data?.items || []).map((p) => <option key={p.project_id} value={p.project_id}>{p.project_code} · {p.name}</option>)}
            </Select>
          </Field>
          <Field label="Reason" required hint="At least 10 characters."><Textarea rows={3} value={rf.reason} onChange={(e) => setRf({ ...rf, reason: e.target.value })} /></Field>
          <Field label="Priority"><Select value={rf.priority} onChange={(e) => setRf({ ...rf, priority: e.target.value })}>{['Low', 'Medium', 'High', 'Urgent'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
        </div>
      </Modal>
    </>
  )
}
