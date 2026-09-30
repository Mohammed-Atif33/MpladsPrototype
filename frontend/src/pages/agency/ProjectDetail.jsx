import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarClock, FilePlus2, FileText, IndianRupee, Send, Upload, Wallet } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDate, inr, inrFull } from '../../lib/format'
import {
  Card, CardHeader, Checkbox, ConfirmDialog, DataTable, DocumentRow, EmptyState, ErrorBanner, Field, FileInput, Input, KeyValue,
  Modal, Notice, PageHeader, ProgressBar, Select, Spinner, Stat, StatusBadge, Tabs, Textarea, useAction, useApi, useToast,
} from '../../components/ui'
import MoneyInput from '../../components/portal/MoneyInput'

const DOC_TYPES = ['Photo', 'Progress Evidence', 'Bill / Invoice', 'Certificate', 'Other']

// ---------------------------------------------------------------- overview
function Overview({ p }) {
  const spent = p.sanctioned_amount ? (p.expenditure / p.sanctioned_amount) * 100 : 0
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader title="Progress" />
          <div className="mb-1 flex justify-between text-sm"><span className="text-slate-500">Actual <b className="text-slate-900">{p.progress}%</b></span><span className="text-slate-500">Planned <b className="text-slate-900">{p.planned_progress ?? '—'}%</b></span></div>
          <ProgressBar value={p.progress} planned={p.planned_progress} />
          {p.planned_progress != null && p.planned_progress - p.progress > 15 && <Notice tone="orange" className="mt-3">Progress is {(p.planned_progress - p.progress).toFixed(0)} points behind the plan. Please include a delay explanation in your next report.</Notice>}
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Stat label="Delay" value={p.delay_days > 0 ? `${p.delay_days} days` : 'None'} />
            <Stat label="Budget revisions" value={p.budget_revisions} />
            <Stat label="Extension requests" value={p.extension_requests} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Financials" icon={Wallet} />
          <KeyValue cols={3} items={[
            ['Sanctioned', inrFull(p.sanctioned_amount)], ['Released', inrFull(p.released_amount)], ['Expenditure', inrFull(p.expenditure)],
            ['Remaining', inrFull(p.remaining_amount)], ['Spent', `${spent.toFixed(1)}% of sanction`],
          ]} />
          <div className="mt-3"><ProgressBar value={spent} tone="bg-amber-500" /></div>
          {(p.payments || []).length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2">Payments recorded</h3>
              <DataTable dense rows={p.payments} rowKey={(r) => r.payment_id} columns={[
                { key: 'paid_on', header: 'Date', render: (r) => fmtDate(r.paid_on) },
                { key: 'amount', header: 'Amount', align: 'right', render: (r) => inrFull(r.amount) },
                { key: 'description', header: 'Description' }, { key: 'reference', header: 'Voucher' },
              ]} />
            </div>
          )}
        </Card>
        {(p.milestones || []).length > 0 && (
          <Card>
            <CardHeader title="Milestones" />
            <DataTable dense rows={p.milestones} rowKey={(r) => `${r.milestone}-${r.planned}`} columns={[
              { key: 'milestone', header: 'Milestone' }, { key: 'planned', header: 'Planned' },
              { key: 'status', header: 'Status', render: (r) => r.status || r.actual || '—' },
            ]} />
          </Card>
        )}
      </div>
      <div className="space-y-5">
        <Card>
          <CardHeader title="Key dates" icon={CalendarClock} />
          <KeyValue cols={1} items={[
            ['Sanctioned', fmtDate(p.sanction_date)], ['Start', fmtDate(p.start_date)], ['Original deadline', fmtDate(p.deadline)],
            ['Revised deadline', fmtDate(p.revised_deadline)], ['Completed', fmtDate(p.completion_date)], ['Reporting period', p.reporting_period],
          ]} />
        </Card>
        <Card>
          <CardHeader title="Open items" />
          <ul className="space-y-1.5 text-sm text-slate-600">
            <li>Open clarifications: <b>{p.open_clarifications}</b></li>
            <li>Verified complaints awaiting response: <b>{p.open_complaints}</b></li>
          </ul>
          <p className="hint">Respond from the Clarifications and Complaints pages.</p>
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- progress reports
function ReportsTab({ p, reload }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [progress, setProgress] = useState('')
  const [expenditure, setExpenditure] = useState('')
  const [period, setPeriod] = useState('')
  const [delay, setDelay] = useState('')
  const [notes, setNotes] = useState('')
  const delayed = p.delay_days > 0 && p.progress < 100

  const openForm = () => { setProgress(String(p.progress)); setExpenditure(String(p.expenditure)); setPeriod(''); setDelay(''); setNotes(''); setError(null); setOpen(true) }
  const [send, { busy, error, setError }] = useAction(async () => {
    await api.post(`/api/projects/${p.project_id}/progress-reports`, {
      progress: Number(progress), expenditure: Number(expenditure), period_label: period.trim() || null,
      delay_explanation: delay.trim() || null, notes: notes.trim() || null,
    })
    toast('Progress report submitted. The officer has been notified.')
    setOpen(false)
    reload()
  })
  const invalid = progress === '' || Number(progress) < 0 || Number(progress) > 100 || expenditure === '' || Number(expenditure) < 0

  return (
    <Card pad={false}>
      <div className="p-4 pb-2">
        <CardHeader title="Progress reports" subtitle="Submitting a report updates the project’s progress and expenditure."
          actions={<button className="btn-primary" onClick={openForm}><FilePlus2 className="h-4 w-4" /> Submit progress report</button>} />
      </div>
      <DataTable rows={p.progress_reports || []} rowKey={(r) => r.report_id}
        empty={<EmptyState title="No progress reports yet" hint="Submit your first report to keep the project up to date." />}
        columns={[
          { key: 'report_date', header: 'Date', render: (r) => fmtDate(r.report_date) },
          { key: 'period_label', header: 'Period' },
          { key: 'progress', header: 'Progress', render: (r) => `${r.progress}%${r.planned_progress != null ? ` (plan ${r.planned_progress}%)` : ''}` },
          { key: 'expenditure', header: 'Expenditure', render: (r) => inr(r.expenditure) },
          { key: 'delay_explanation', header: 'Delay explanation / notes', className: 'text-xs', render: (r) => <div className="max-w-xs whitespace-normal break-words">{r.delay_explanation || r.notes || '—'}</div> },
        ]} />

      <Modal open={open} onClose={() => setOpen(false)} title="Submit progress report" size="lg"
        footer={<><button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-primary" disabled={busy || invalid} onClick={send}><Send className="h-4 w-4" /> {busy ? 'Submitting…' : 'Submit report'}</button></>}>
        <div className="space-y-4">
          <ErrorBanner error={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Actual progress (%)" required hint={`Recorded so far: ${p.progress}%. Progress cannot go down.`}>
              <Input type="number" min="0" max="100" step="0.5" value={progress} onChange={(e) => setProgress(e.target.value)} />
            </Field>
            <Field label="Reporting period" hint="e.g. Oct 2025"><Input value={period} maxLength={80} onChange={(e) => setPeriod(e.target.value)} /></Field>
          </div>
          <Field label="Total expenditure to date (₹)" required hint={`Recorded so far: ${inrFull(p.expenditure)} · Funds released: ${inrFull(p.released_amount)}`}>
            <MoneyInput value={expenditure} onChange={setExpenditure} />
          </Field>
          <Field label="Delay explanation" required={delayed} hint={delayed ? `This project is ${p.delay_days} days behind its original deadline - an explanation is required.` : 'Optional while the project is on schedule.'}>
            <Textarea rows={3} value={delay} maxLength={3000} onChange={(e) => setDelay(e.target.value)} />
          </Field>
          <Field label="Notes"><Textarea rows={2} value={notes} maxLength={3000} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </Modal>
    </Card>
  )
}

// ---------------------------------------------------------------- documents
function DocumentsTab({ p, reload }) {
  const toast = useToast()
  const [files, setFiles] = useState([])
  const [type, setType] = useState('Photo')
  const [desc, setDesc] = useState('')
  const [pub, setPub] = useState(false)
  const [send, { busy, error }] = useAction(async () => {
    const fd = new FormData()
    fd.append('file', files[0])
    fd.append('document_type', type)
    fd.append('description', desc.trim())
    fd.append('is_public', pub ? 'true' : 'false')
    await api.upload(`/api/projects/${p.project_id}/documents`, fd)
    toast('Document uploaded.')
    setFiles([]); setDesc(''); setPub(false)
    reload()
  })
  const docs = p.documents || []
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Project documents & photos" icon={FileText} subtitle="Uploaded files are versioned - re-uploading a file with the same name creates a new version." />
        {docs.length === 0 ? <EmptyState title="No documents yet" /> : <ul className="space-y-2">{docs.map((d) => <DocumentRow key={d.document_id} doc={d} />)}</ul>}
      </Card>
      <Card>
        <CardHeader title="Upload evidence" icon={Upload} />
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (files.length) send() }}>
          <ErrorBanner error={error} />
          <Field label="File" required hint="JPG, PNG, WebP, GIF or PDF - up to 10 MB."><FileInput files={files} onChange={setFiles} accept="image/*,application/pdf" /></Field>
          <Field label="Document type"><Select value={type} onChange={(e) => setType(e.target.value)}>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Description"><Input value={desc} maxLength={255} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Base course completed, Sector B" /></Field>
          <Checkbox checked={pub} onChange={setPub} label="Make public for citizens" hint="Public photos appear on the citizen project page." />
          <button className="btn-primary w-full" disabled={busy || !files.length}><Upload className="h-4 w-4" /> {busy ? 'Uploading…' : 'Upload'}</button>
          <p className="hint">Uploaded documents cannot be deleted by the agency.</p>
        </form>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- requests
function RequestsTab({ p, reload }) {
  const toast = useToast()
  const [kind, setKind] = useState(null) // 'Extension' | 'Budget Change'
  const [deadline, setDeadline] = useState('')
  const [amount, setAmount] = useState('')
  const [why, setWhy] = useState('')
  const [confirm, setConfirm] = useState(false)
  const reqs = p.requests || []
  const hasPending = (t) => reqs.some((r) => r.request_type === t && r.status === 'Pending')
  const currentDeadline = p.revised_deadline || p.deadline

  const start = (t) => { setKind(t); setDeadline(''); setAmount(''); setWhy(''); setError(null); setConfirm(false) }
  const [send, { busy, error, setError }] = useAction(async () => {
    await api.post(`/api/projects/${p.project_id}/requests`, {
      request_type: kind, justification: why.trim(),
      requested_deadline: kind === 'Extension' ? deadline : null,
      requested_amount: kind === 'Budget Change' ? Number(amount) : null,
    })
    toast(`${kind} request submitted for officer review.`)
    setConfirm(false); setKind(null)
    reload()
  })
  const invalid = why.trim().length < 10 || (kind === 'Extension' ? !deadline : !(Number(amount) > 0))

  return (
    <Card pad={false}>
      <div className="p-4 pb-2">
        <CardHeader title="Extension & budget requests" subtitle="Requests are decided by an officer; you will be notified."
          actions={<>
            <button className="btn-secondary" disabled={hasPending('Extension')} onClick={() => start('Extension')}><CalendarClock className="h-4 w-4" /> Request extension</button>
            <button className="btn-secondary" disabled={hasPending('Budget Change')} onClick={() => start('Budget Change')}><IndianRupee className="h-4 w-4" /> Request budget change</button>
          </>} />
      </div>
      <DataTable rows={reqs} rowKey={(r) => r.request_id} empty={<EmptyState title="No requests yet" />}
        columns={[
          { key: 'created_at', header: 'Submitted', render: (r) => fmtDate(r.created_at) },
          { key: 'request_type', header: 'Type' },
          { key: 'ask', header: 'Requested', render: (r) => (r.request_type === 'Extension' ? `Deadline → ${fmtDate(r.requested_deadline)}` : `Sanction → ${inrFull(r.requested_amount)}`) },
          { key: 'justification', header: 'Justification', className: 'max-w-xs text-xs' },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'decision_note', header: 'Officer decision', className: 'max-w-xs text-xs', render: (r) => (r.decision_note ? <div><div>{r.decision_note}</div><div className="text-slate-400">{fmtDate(r.decided_at)}</div></div> : '—') },
        ]} />

      <Modal open={!!kind && !confirm} onClose={() => setKind(null)} title={kind === 'Extension' ? 'Request a deadline extension' : 'Request a budget change'}
        footer={<><button className="btn-secondary" onClick={() => setKind(null)}>Cancel</button><button className="btn-primary" disabled={invalid} onClick={() => setConfirm(true)}>Review & submit</button></>}>
        <div className="space-y-4">
          <ErrorBanner error={error} />
          {kind === 'Extension' ? (
            <Field label="New requested deadline" required hint={`Current deadline: ${fmtDate(currentDeadline)}. Must be later.`}>
              <Input type="date" min={currentDeadline || undefined} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
          ) : (
            <Field label="Requested revised sanctioned amount (₹)" required hint={`Currently sanctioned: ${inrFull(p.sanctioned_amount)}`}>
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
          )}
          <Field label="Justification" required hint={`${why.trim().length} characters (minimum 10)`}>
            <Textarea rows={4} value={why} maxLength={3000} onChange={(e) => setWhy(e.target.value)} placeholder="Explain why this is needed and what will change." />
          </Field>
        </div>
      </Modal>
      <ConfirmDialog open={confirm} busy={busy} title={`Submit ${kind?.toLowerCase()} request?`} confirmLabel="Submit request" onCancel={() => setConfirm(false)} onConfirm={send}
        message={kind === 'Extension' ? `You are asking to move the deadline to ${fmtDate(deadline)}. This counts as an extension request on the project record.` : `You are asking to change the sanctioned amount to ${inrFull(amount)}.`}>
        <ErrorBanner error={error} className="mt-3" />
      </ConfirmDialog>
    </Card>
  )
}

export default function AgencyProjectDetail() {
  const { id } = useParams()
  const { data: p, loading, error, reload } = useApi(() => api.get(`/api/projects/${id}`), [id])
  const [tab, setTab] = useState('overview')

  if (loading && !p) return <Spinner />
  if (error) return <><PageHeader title="Project" back={{ to: '/agency/projects', label: 'Assigned projects' }} /><ErrorBanner error={error} onRetry={reload} /></>
  if (!p) return null

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'reports', label: 'Progress reports', count: (p.progress_reports || []).length },
    { key: 'documents', label: 'Documents', count: (p.documents || []).length },
    { key: 'requests', label: 'Requests', count: (p.requests || []).length },
  ]
  return (
    <>
      <PageHeader back={{ to: '/agency/projects', label: 'Assigned projects' }} title={p.name} subtitle={`${p.project_code} · ${p.category} · ${p.location}`}
        actions={<StatusBadge status={p.agency_status} />} />
      <div className="mb-5"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
      {tab === 'overview' && <Overview p={p} />}
      {tab === 'reports' && <ReportsTab p={p} reload={reload} />}
      {tab === 'documents' && <DocumentsTab p={p} reload={reload} />}
      {tab === 'requests' && <RequestsTab p={p} reload={reload} />}
    </>
  )
}
