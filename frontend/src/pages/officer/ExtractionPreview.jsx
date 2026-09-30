import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, FileText, Info, Pencil, Save, ShieldCheck, Trash2, X, XCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDate, inr, inrFull } from '../../lib/format'
import {
  Card, CardHeader, Checkbox, ConfidenceBadge, ConfirmDialog, DocumentRow, EmptyState, ErrorBanner, Field, Input, Modal, Notice, PageHeader,
  Spinner, StatusBadge, Textarea, useApi, useToast,
} from '../../components/ui'

const GROUPS = ['Project', 'Financial', 'Timeline', 'Progress']

const curStr = (f) => (f.value === null || f.value === undefined ? '' : String(f.value))

function display(f) {
  const v = f.value
  if (v === null || v === undefined || v === '') return <span className="text-slate-400">not found</span>
  if (f.type === 'money') return <>{inrFull(v)} <span className="text-xs text-slate-400">({inr(v)})</span></>
  if (f.type === 'date') return fmtDate(v)
  if (f.type === 'percent') return `${v}%`
  return <span className="break-words">{String(v)}</span>
}

function sourceLabel(f) {
  if (f.derived) return 'Derived'
  return f.source_page ? `Page ${f.source_page}` : '—'
}

function ValueInput({ f, value, onChange }) {
  const t = f.type
  if (t === 'longtext') return <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
  if (t === 'date') return <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
  if (t === 'money') {
    return (
      <div>
        <Input type="number" step="any" min="0" value={value} onChange={(e) => onChange(e.target.value)} />
        <div className="hint">{value !== '' && !Number.isNaN(Number(value)) ? `= ${inr(Number(value))}` : 'Enter the amount in rupees'}</div>
      </div>
    )
  }
  if (t === 'percent' || t === 'int' || t === 'float') return <Input type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)} />
  return <Input value={value} onChange={(e) => onChange(e.target.value)} />
}

function ValidationPanel({ v, labels }) {
  if (!v) return null
  const lab = (k) => labels[k] || (k ? k.replace(/_/g, ' ') : 'General')
  const block = (items, tone, Icon, title) => items?.length > 0 && (
    <div className={clsx('rounded-md border p-3', tone)}>
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><Icon className="h-4 w-4" /> {title} ({items.length})</div>
      <ul className="space-y-1.5 text-sm">
        {items.map((e, i) => <li key={i}><span className="font-medium">{lab(e.field)}:</span> {e.message}</li>)}
      </ul>
    </div>
  )
  return (
    <div className="space-y-2.5">
      {block(v.errors, 'border-red-200 bg-red-50 text-red-800', XCircle, 'Errors - must be corrected')}
      {block(v.warnings, 'border-yellow-200 bg-yellow-50 text-yellow-900', AlertTriangle, 'Warnings - review before verifying')}
      {block(v.infos, 'border-blue-200 bg-blue-50 text-blue-800', Info, 'Notes')}
      {!v.errors?.length && !v.warnings?.length && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 className="h-4 w-4" /> All validation checks passed.</div>
      )}
    </div>
  )
}

export default function ExtractionPreview() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: ex, loading, error, reload, setData } = useApi(() => api.get(`/api/extractions/${id}`), [id])

  const [editing, setEditing] = useState(false)
  const [edits, setEdits] = useState({})
  const [payEdits, setPayEdits] = useState(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState(null)

  const [verifyOpen, setVerifyOpen] = useState(false)
  const [ack, setAck] = useState(false)
  const [publish, setPublish] = useState(true)
  const [vReason, setVReason] = useState('')
  const [vBusy, setVBusy] = useState(false)
  const [vErr, setVErr] = useState(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [dBusy, setDBusy] = useState(false)

  const pending = ex?.status === 'Pending Verification'
  const labels = useMemo(() => {
    const m = { payments: 'Payments', documents: 'Documents' }
    ;(ex?.fields || []).forEach((f) => { m[f.key] = f.label })
    return m
  }, [ex])
  const issueMap = useMemo(() => {
    const m = {}
    ;(ex?.validation?.errors || []).forEach((e) => { m[e.field] = 'error' })
    ;(ex?.validation?.warnings || []).forEach((e) => { if (m[e.field] !== 'error') m[e.field] = 'warning' })
    return m
  }, [ex])

  if (loading && !ex) return <Spinner />
  if (error && !ex) return <ErrorBanner error={error} onRetry={reload} />

  const v = ex.validation
  const changedKeys = ex.fields.filter((f) => edits[f.key] !== undefined && edits[f.key] !== curStr(f)).map((f) => f.key)
  const payChanged = payEdits !== null && JSON.stringify(payEdits) !== JSON.stringify(ex.payments)
  const dirty = changedKeys.length > 0 || payChanged
  const hasErrors = (v?.errors?.length || 0) > 0
  const hasWarnings = (v?.warnings?.length || 0) > 0

  const startEdit = () => { setEditing(true); setEdits({}); setPayEdits(JSON.parse(JSON.stringify(ex.payments || []))); setSaveErr(null) }
  const cancelEdit = () => { setEditing(false); setEdits({}); setPayEdits(null); setReason(''); setSaveErr(null) }

  const save = async () => {
    setSaving(true); setSaveErr(null)
    try {
      const fields = {}
      changedKeys.forEach((k) => { fields[k] = edits[k] })
      const body = { fields, reason: reason.trim() || undefined }
      if (payChanged) body.payments = payEdits
      const res = await api.put(`/api/extractions/${id}`, body)
      setData(res)
      cancelEdit()
      toast(`Saved ${changedKeys.length + (payChanged ? 1 : 0)} correction(s). Validation refreshed; corrections were written to the audit trail.`)
    } catch (e) { setSaveErr(e) } finally { setSaving(false) }
  }

  const openVerify = () => { setAck(false); setPublish(true); setVReason(''); setVErr(null); setVerifyOpen(true) }
  const verify = async () => {
    setVBusy(true); setVErr(null)
    try {
      const res = await api.post(`/api/extractions/${id}/verify`, {
        analyze: true, acknowledge_warnings: ack, publish_to_citizens: publish, reason: vReason.trim() || undefined,
      })
      toast('Data verified and stored. Risk analysis complete.')
      navigate(`/officer/projects/${res.project_id}?tab=risk&fresh=1`)
    } catch (e) {
      setVErr(e)
      if (e.validation) setData((d) => ({ ...d, validation: e.validation }))
      else reload()
    } finally { setVBusy(false) }
  }

  const discard = async () => {
    setDBusy(true)
    try { await api.post(`/api/extractions/${id}/discard`); toast('Extraction discarded.', 'info'); navigate('/officer/extractions') }
    catch (e) { toast(e.message, 'error'); setDiscardOpen(false) } finally { setDBusy(false) }
  }

  const grouped = GROUPS.map((g) => [g, ex.fields.filter((f) => f.group === g)])
  const cs = ex.confidence_summary || {}
  const code = ex.fields.find((f) => f.key === 'project_code')?.value
  const pname = ex.fields.find((f) => f.key === 'name')?.value

  return (
    <>
      <PageHeader back={{ to: '/officer/extractions', label: 'Verification queue' }} title="Extraction Preview & Data Validation"
        subtitle={`${pname || 'Unnamed project'}${code ? ` · ${code}` : ''}`}
        actions={<StatusBadge status={ex.status} />} />

      {!pending && (
        <Notice tone={ex.status === 'Verified' ? 'green' : 'yellow'} className="mb-4">
          This extraction is <b>{ex.status.toLowerCase()}</b> and is read-only.
          {ex.project_id && <> <Link to={`/officer/projects/${ex.project_id}`} className="font-medium underline">Open the project →</Link></>}
        </Notice>
      )}
      {pending && <Notice className="mb-4">Review the extracted values, confidence and source pages. Correct anything that looks wrong, then <b>Verify &amp; Analyze</b>. Risk analysis only runs on verified data.</Notice>}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card pad={false}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">Confidence:</span>
                {['High', 'Medium', 'Low', 'Missing'].map((b) => <span key={b} className="inline-flex items-center gap-1"><ConfidenceBadge level={b} /> {cs[b] ?? 0}</span>)}
              </div>
              {pending && (editing ? (
                <div className="flex gap-2">
                  <button className="btn-secondary btn-sm" onClick={cancelEdit} disabled={saving}><X className="h-3.5 w-3.5" /> Cancel</button>
                  <button className="btn-primary btn-sm" onClick={save} disabled={saving || !dirty}><Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : `Save changes${dirty ? ` (${changedKeys.length + (payChanged ? 1 : 0)})` : ''}`}</button>
                </div>
              ) : <button className="btn-secondary btn-sm" onClick={startEdit}><Pencil className="h-3.5 w-3.5" /> Edit Data</button>)}
            </div>
            {editing && (
              <div className="border-b border-slate-200 bg-yellow-50/50 px-4 py-3">
                <ErrorBanner error={saveErr} className="mb-2" />
                <Field label="Reason for correction (recorded in the audit trail)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Corrected against the sanction order" /></Field>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead><tr><th className="th">Field</th><th className="th">Value</th><th className="th">Confidence</th><th className="th">Source Page</th></tr></thead>
                {grouped.map(([g, fs]) => fs.length > 0 && (
                  <tbody key={g} className="divide-y divide-slate-100">
                    <tr><td colSpan={4} className="bg-navy-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-navy-700">{g}</td></tr>
                    {fs.map((f) => {
                      const issue = issueMap[f.key]
                      const val = edits[f.key] !== undefined ? edits[f.key] : curStr(f)
                      return (
                        <tr key={f.key} className={clsx(issue === 'error' && 'bg-red-50/60', issue === 'warning' && 'bg-yellow-50/50', edits[f.key] !== undefined && edits[f.key] !== curStr(f) && 'bg-blue-50/60')}>
                          <td className="td w-48 font-medium text-slate-800">
                            {f.label}
                            {issue === 'error' && <XCircle className="ml-1 inline h-3.5 w-3.5 text-red-600" />}
                            {issue === 'warning' && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-yellow-600" />}
                          </td>
                          <td className="td min-w-[16rem]">
                            {editing ? <ValueInput f={f} value={val} onChange={(x) => setEdits((e) => ({ ...e, [f.key]: x }))} /> : display(f)}
                            {f.edited && <span className="ml-2 pill bg-blue-100 text-blue-800">edited</span>}
                            {f.note && <div className="mt-1 text-xs text-slate-500">{f.note}</div>}
                            {f.edited && f.original !== null && f.original !== undefined && f.original !== f.value && <div className="mt-1 text-xs text-slate-400">Extracted as: {String(f.original)}</div>}
                          </td>
                          <td className="td"><ConfidenceBadge level={f.confidence} /></td>
                          <td className="td whitespace-nowrap text-slate-600">{sourceLabel(f)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                ))}
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Payments" subtitle="Payment schedule found in the document" />
            {(editing ? payEdits : ex.payments)?.length ? (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead><tr><th className="th">Date</th><th className="th text-right">Amount</th><th className="th">Description</th><th className="th">Reference</th><th className="th">Source</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(editing ? payEdits : ex.payments).map((p, i) => (
                      <tr key={i}>
                        <td className="td">{editing ? <Input type="date" value={p.paid_on || ''} onChange={(e) => setPayEdits((xs) => xs.map((x, j) => (j === i ? { ...x, paid_on: e.target.value || null } : x)))} /> : fmtDate(p.paid_on)}</td>
                        <td className="td text-right">{editing ? <Input type="number" step="any" value={p.amount ?? ''} onChange={(e) => setPayEdits((xs) => xs.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} /> : inrFull(p.amount)}</td>
                        <td className="td">{editing ? <Input value={p.description || ''} onChange={(e) => setPayEdits((xs) => xs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /> : p.description || '—'}</td>
                        <td className="td">{p.reference || '—'}</td>
                        <td className="td">{p.source_page ? `Page ${p.source_page}` : '—'}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50"><td className="td font-semibold">Total</td><td className="td text-right font-semibold">{inrFull((editing ? payEdits : ex.payments).reduce((s, p) => s + (Number(p.amount) || 0), 0))}</td><td colSpan={3} /></tr>
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No payment table found" hint="The PDF does not contain a recognisable payment schedule." />}
          </Card>

          <Card>
            <CardHeader title="Milestones" />
            {ex.milestones?.length ? (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead><tr><th className="th">Milestone</th><th className="th">Planned</th><th className="th">Actual / status</th><th className="th">Source</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {ex.milestones.map((m, i) => (
                      <tr key={i}><td className="td font-medium">{m.milestone}</td><td className="td">{m.planned || '—'}</td><td className="td">{m.actual || m.status || '—'}</td><td className="td">{m.source_page ? `Page ${m.source_page}` : '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No milestones found" />}
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="xl:sticky xl:top-20">
            <CardHeader title="Validation" icon={ShieldCheck} subtitle={v?.agency_name ? `Matched agency: ${v.agency_name}` : 'No registered agency matched yet'} />
            <ValidationPanel v={v} labels={labels} />
            {pending && (
              <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
                <button className="btn-primary w-full" onClick={openVerify} disabled={hasErrors || dirty || editing}>
                  <ShieldCheck className="h-4 w-4" /> Verify &amp; Analyze
                </button>
                {hasErrors && <p className="text-xs text-red-600">Correct the errors above (use Edit Data) before verifying.</p>}
                {!hasErrors && (dirty || editing) && <p className="text-xs text-slate-500">Save or cancel your edits first.</p>}
                <button className="btn-secondary w-full" onClick={() => setDiscardOpen(true)}><Trash2 className="h-4 w-4" /> Discard extraction</button>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Source document" icon={FileText} />
            {ex.document ? <ul><DocumentRow doc={ex.document} /></ul> : <EmptyState title="No document" />}
            <div className="mt-3 text-xs text-slate-500">
              {ex.notes?.page_count} page(s){ex.notes?.ocr_pages?.length ? ` · OCR used on page(s) ${ex.notes.ocr_pages.join(', ')}` : ''}
              {ex.notes?.ocr_unavailable ? ' · OCR engine unavailable' : ''}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={verifyOpen} title="Verify & analyze this project?" onClose={() => !vBusy && setVerifyOpen(false)}
        footer={<>
          <button className="btn-secondary" onClick={() => setVerifyOpen(false)} disabled={vBusy}>Cancel</button>
          <button className="btn-primary" onClick={verify} disabled={vBusy || hasErrors || (hasWarnings && !ack)}>{vBusy ? 'Verifying & analysing…' : 'Verify & Analyze'}</button>
        </>}
      >
        <p className="text-sm text-slate-600">The verified data will be stored as a project, compared with historical projects and analysed. This is recorded in the audit trail.</p>
        <div className="mt-3 space-y-3">
          <ErrorBanner error={vErr} />
          {vErr?.validation && <ValidationPanel v={vErr.validation} labels={labels} />}
          {hasWarnings && (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3">
              <div className="mb-2 text-sm font-medium text-yellow-900">{v.warnings.length} warning(s) remain</div>
              <Checkbox checked={ack} onChange={setAck} label="I have reviewed the warnings and want to proceed" />
            </div>
          )}
          <Checkbox checked={publish} onChange={setPublish} label="Publish to citizen portal" hint="Public project details (no risk information) become visible to citizens." />
          <Field label="Note (optional)"><Textarea rows={2} value={vReason} onChange={(e) => setVReason(e.target.value)} placeholder="Recorded with the verification" /></Field>
          {hasWarnings && !ack && <p className="text-xs text-slate-500">Tick the checkbox to enable verification.</p>}
        </div>
      </Modal>

      <ConfirmDialog open={discardOpen} title="Discard this extraction?" tone="danger" confirmLabel="Discard" busy={dBusy}
        message="The extracted data will not be stored as a project. The uploaded PDF stays in the audit history." onCancel={() => setDiscardOpen(false)} onConfirm={discard} />
    </>
  )
}
