import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { ROLE } from '../../lib/nav'
import { Checkbox, ConfirmDialog, ErrorBanner, Field, Input, Modal, Notice, Select, Spinner, Textarea, useApi, useToast } from '../ui'

const HELP = {
  'Clear for Routine Monitoring': 'The project returns to routine monitoring. If it is High/Critical, the Head Officer is notified that it was cleared after investigation.',
  'Request Clarification': 'Sends a clarification request to the implementing agency and asks it to respond.',
  'Request Inspection': 'Creates an inspection request; the Head Officer assigns an inspector.',
  'Escalate to Head Officer': 'Sends the case to the Head Officer for supervisory review.',
  'Keep Under Review': 'Keeps the case open with a follow-up date or action.',
  Acknowledge: 'Confirms the Head Officer has taken the case under supervisory review.',
  'Request Evidence': 'Asks the officer and agency for additional evidence.',
  Reopen: 'Reopens the case for further investigation.',
  'Assign Inspection': 'Creates an inspection and assigns it to an inspector.',
  'Add Supervisory Note': 'Adds a confidential supervisory note (visible only to officers).',
  'Escalate Further': 'Escalates beyond the Head Officer level and raises a critical notification.',
  'Close Review': 'Closes the supervisory review of this case.',
}
const TONE = { 'Clear for Routine Monitoring': 'success', 'Escalate to Head Officer': 'warn', 'Escalate Further': 'danger', 'Close Review': 'success' }

/** Record an officer decision or a head-officer supervisory action. Every submission writes an audit record. */
export default function DecisionDialog({ open, onClose, project, role, onDone }) {
  const toast = useToast()
  const isHead = role === ROLE.HEAD
  const opts = useApi(() => api.get('/api/decisions/options'), [], { enabled: open })
  const inspectors = useApi(() => api.get('/api/users/inspectors'), [], { enabled: open && isHead })

  const [decision, setDecision] = useState('')
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState([])
  const [followDate, setFollowDate] = useState('')
  const [action, setAction] = useState('')
  const [priority, setPriority] = useState('Medium')
  const [question, setQuestion] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [inspector, setInspector] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (open) {
      setDecision(''); setReason(''); setEvidence([]); setFollowDate(''); setAction(''); setPriority('Medium')
      setQuestion(''); setDueDate(''); setInspector(''); setErr(null); setConfirm(false)
    }
  }, [open])

  const decisions = opts.data?.decisions || []
  const evidenceOptions = opts.data?.evidence || []

  const problem = useMemo(() => {
    if (!decision) return 'Choose a decision.'
    if (reason.trim().length < 10) return 'Enter a reason (at least 10 characters).'
    if (decision !== 'Add Supervisory Note' && evidence.length === 0) return 'Select the evidence you reviewed.'
    if (!isHead && !followDate && !action.trim()) return 'Provide a follow-up date or a follow-up action.'
    if (decision === 'Assign Inspection' && !inspector) return 'Select an inspector.'
    return ''
  }, [decision, reason, evidence, followDate, action, inspector, isHead])

  const toggleEvidence = (e, on) => setEvidence((xs) => (on ? [...xs, e] : xs.filter((x) => x !== e)))

  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const body = {
        project_id: project.project_id, decision, reason: reason.trim(), evidence_reviewed: evidence,
        follow_up_date: followDate || null, action: action.trim() || null, priority,
        question: decision === 'Request Clarification' ? question.trim() || null : null,
        inspector_id: decision === 'Assign Inspection' ? Number(inspector) : null,
        due_date: (decision === 'Request Clarification' || decision === 'Assign Inspection') && dueDate ? dueDate : null,
      }
      const res = await api.post('/api/decisions', body)
      toast(`Decision recorded: ${decision}. Status is now “${res.project_status}”. An audit record was created.`)
      setConfirm(false); onClose(); onDone?.(res)
    } catch (e) { setErr(e); setConfirm(false) } finally { setBusy(false) }
  }

  return (
    <>
      <Modal open={open && !confirm} onClose={onClose} size="lg" title={isHead ? 'Supervisory action' : 'Record decision'}
        footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!!problem} onClick={() => setConfirm(true)}>Review & submit</button></>}>
        {opts.loading && !opts.data ? <Spinner /> : (
          <div className="space-y-4">
            <ErrorBanner error={opts.error || err} />
            <div className="text-sm text-slate-600"><b>{project.project_code}</b> · {project.name}</div>
            <Field label="Decision" required>
              <Select value={decision} onChange={(e) => setDecision(e.target.value)}>
                <option value="">Select…</option>
                {decisions.map((d) => <option key={d}>{d}</option>)}
              </Select>
              {decision && <p className="hint">{HELP[decision]}</p>}
            </Field>

            <Field label="Reason" required hint="Explain the reasoning. This is stored with the decision and in the audit trail.">
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>

            {decision !== 'Add Supervisory Note' && (
              <Field label="Evidence reviewed" required>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {evidenceOptions.map((e) => <Checkbox key={e} checked={evidence.includes(e)} onChange={(on) => toggleEvidence(e, on)} label={e} />)}
                </div>
              </Field>
            )}

            {decision === 'Request Clarification' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Question for the agency" className="sm:col-span-2" hint="Defaults to the reason if left empty."><Textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} /></Field>
                <Field label="Response due by"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
              </div>
            )}
            {(decision === 'Request Inspection' || decision === 'Assign Inspection') && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value)}>{['Low', 'Medium', 'High', 'Urgent'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
                {decision === 'Assign Inspection' && <>
                  <Field label="Inspector" required>
                    <Select value={inspector} onChange={(e) => setInspector(e.target.value)}>
                      <option value="">Select inspector…</option>
                      {(inspectors.data || []).map((i) => <option key={i.user_id} value={i.user_id}>{i.name}{i.department ? ` · ${i.department}` : ''}</option>)}
                    </Select>
                  </Field>
                  <Field label="Inspection due by"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
                </>}
              </div>
            )}

            {!isHead && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Follow-up date"><Input type="date" value={followDate} onChange={(e) => setFollowDate(e.target.value)} /></Field>
                <Field label="Follow-up action"><Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. Review next progress report" /></Field>
                <p className="hint sm:col-span-2 -mt-1">A follow-up date and/or action is required.</p>
              </div>
            )}
            {isHead && decision !== 'Add Supervisory Note' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Follow-up action (optional)"><Input value={action} onChange={(e) => setAction(e.target.value)} /></Field>
              </div>
            )}
            {problem && decision && <Notice tone="yellow">{problem}</Notice>}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={confirm} busy={busy} tone={TONE[decision] || 'primary'} title={`Confirm: ${decision}`} confirmLabel="Confirm & record"
        message={`This will update ${project.project_code}, notify the relevant users and write an audit record. It cannot be undone.`}
        onCancel={() => setConfirm(false)} onConfirm={submit} />
    </>
  )
}
