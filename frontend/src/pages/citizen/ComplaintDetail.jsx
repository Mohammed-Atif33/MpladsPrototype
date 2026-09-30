import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Gavel, MessageSquareReply, ThumbsDown, ThumbsUp } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDate, fmtDateTime } from '../../lib/format'
import {
  Card, CardHeader, ConfirmDialog, ErrorBanner, Field, KeyValue, Notice, PageHeader, Pill, Spinner, StatusBadge, Textarea,
  useAction, useApi, useToast,
} from '../../components/ui'
import { StarInput } from '../../components/portal/Stars'
import ComplaintStepper from '../../components/portal/ComplaintStepper'
import EvidenceGallery from '../../components/portal/EvidenceGallery'

/** Plain-language explanation of where the complaint is and what happens next. */
function nextStep(c) {
  if (c.appeal_status === 'Pending') return ['blue', 'Your appeal is with the Head Officer for review. You will be notified of the decision.']
  if (c.appeal_status === 'Upheld') return ['green', 'Your appeal was upheld and the complaint has been reopened for investigation.']
  if (c.appeal_status === 'Rejected') return ['slate', 'Your appeal was reviewed and the complaint is now closed.']
  switch (c.status) {
    case 'Submitted': return ['blue', 'An officer will screen your complaint to check it is genuine and complete. This is the next step.']
    case 'Assigned': return ['blue', 'Your complaint was verified and sent to the implementing agency, which must respond.']
    case 'Under Investigation': return ['yellow', 'The complaint is being investigated. An officer will record the resolution once the issue is dealt with.']
    case 'Resolved': return c.feedback_satisfied === null
      ? ['orange', 'A resolution has been recorded. Please tell us whether the problem was fixed.']
      : c.feedback_satisfied === false
        ? ['orange', 'You said you are not satisfied. You can appeal to the Head Officer below.']
        : ['green', 'Thank you for your feedback.']
    case 'Rejected': return ['slate', 'The complaint could not be verified at screening. If you disagree, you can file an appeal.']
    case 'Closed': return ['green', 'This complaint is closed. Thank you for helping improve public projects.']
    default: return ['blue', '']
  }
}

export default function CitizenComplaintDetail() {
  const { id } = useParams()
  const toast = useToast()
  const { data: c, loading, error, reload, setData } = useApi(() => api.get(`/api/complaints/${id}`), [id])

  const [satisfied, setSatisfied] = useState(null)
  const [rating, setRating] = useState(0)
  const [fbText, setFbText] = useState('')
  const [appealText, setAppealText] = useState('')
  const [confirm, setConfirm] = useState(null) // 'feedback' | 'appeal'

  const [act, { busy, error: actError, setError }] = useAction(async (body, msg) => {
    const updated = await api.put(`/api/complaints/${id}`, body)
    setData(updated)
    setConfirm(null)
    toast(msg)
  })

  if (loading && !c) return <Spinner />
  if (error) return <><PageHeader title="Complaint" back={{ to: '/citizen/complaints', label: 'My complaints' }} /><ErrorBanner error={error} onRetry={reload} /></>
  if (!c) return null

  const canFeedback = c.status === 'Resolved' && c.feedback_satisfied === null
  const canAppeal = ((c.status === 'Resolved' && c.feedback_satisfied === false) || c.status === 'Rejected') && c.appeal_status === 'None'
  const [tone, next] = nextStep(c)

  return (
    <>
      <PageHeader back={{ to: '/citizen/complaints', label: 'My complaints' }} title={`Complaint ${c.tracking_id}`}
        subtitle={c.project_name ? `${c.project_name} (${c.project_code})` : c.project_code}
        actions={<><StatusBadge status={c.status} />{c.anonymous && <Pill>Anonymous</Pill>}</>} />

      <Card className="mb-5">
        <CardHeader title="Tracking" />
        <ComplaintStepper steps={c.timeline || []} />
        {next && <Notice tone={tone === 'slate' ? 'blue' : tone} className="mt-5"><b>What happens next: </b>{next}</Notice>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Your complaint" />
            <KeyValue items={[['Category', c.category], ['Submitted', fmtDateTime(c.created_at)], ['Incident date', fmtDate(c.incident_date)], ['Location', c.location_text]]} />
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{c.description}</p>
            <h3 className="mb-2 mt-5">Attachments</h3>
            <EvidenceGallery evidence={c.evidence} />
          </Card>

          {(c.response || c.resolution) && (
            <Card>
              <CardHeader title="Response & resolution" icon={MessageSquareReply} />
              {c.response && <div className="mb-3"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Agency response</div><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{c.response}</p></div>}
              {c.resolution && <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resolution recorded by the officer</div><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{c.resolution}</p></div>}
            </Card>
          )}

          {c.feedback_satisfied !== null && c.feedback_satisfied !== undefined && (
            <Card>
              <CardHeader title="Your feedback" />
              <div className="flex items-center gap-2 text-sm">{c.feedback_satisfied ? <ThumbsUp className="h-4 w-4 text-green-600" /> : <ThumbsDown className="h-4 w-4 text-red-600" />}
                {c.feedback_satisfied ? 'You were satisfied with the resolution.' : 'You were not satisfied with the resolution.'}</div>
              {c.feedback_comment && <p className="mt-2 text-sm text-slate-600">“{c.feedback_comment}”</p>}
            </Card>
          )}

          {c.appeal && (
            <Card>
              <CardHeader title="Appeal" icon={Gavel} actions={<StatusBadge status={c.appeal_status === 'None' ? '' : c.appeal_status === 'Pending' ? 'Pending' : c.appeal_status === 'Upheld' ? 'Approved' : 'Rejected'} />} />
              <p className="whitespace-pre-wrap text-sm text-slate-700">{c.appeal}</p>
              {c.appeal_status !== 'Pending' && c.appeal_decision_note && (
                <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Head Officer decision ({c.appeal_status})</div><p className="mt-1 text-slate-700">{c.appeal_decision_note}</p></div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {canFeedback && (
            <Card className="border-orange-200">
              <CardHeader title="Give resolution feedback" />
              <ErrorBanner error={actError} className="mb-3" />
              <p className="mb-3 text-sm text-slate-600">Was the problem fixed to your satisfaction?</p>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setSatisfied(true)} className={`btn ${satisfied === true ? 'bg-green-600 text-white' : 'btn-secondary'}`}><ThumbsUp className="h-4 w-4" /> Yes</button>
                <button type="button" onClick={() => setSatisfied(false)} className={`btn ${satisfied === false ? 'bg-red-600 text-white' : 'btn-secondary'}`}><ThumbsDown className="h-4 w-4" /> No</button>
              </div>
              <Field label="Rating (optional)"><StarInput value={rating} onChange={setRating} /></Field>
              <Field label="Comment" className="mt-3"><Textarea value={fbText} maxLength={4000} onChange={(e) => setFbText(e.target.value)} /></Field>
              <button className="btn-primary mt-3 w-full" disabled={satisfied === null} onClick={() => { setError(null); setConfirm('feedback') }}>Submit feedback</button>
            </Card>
          )}
          {canAppeal && (
            <Card className="border-purple-200">
              <CardHeader title="File an appeal" />
              <ErrorBanner error={actError} className="mb-3" />
              <p className="mb-3 text-sm text-slate-600">If you disagree with the outcome, the Head Officer will review your appeal.</p>
              <Field label="Why are you appealing?" required hint={`${appealText.trim().length} characters (minimum 10)`}>
                <Textarea rows={4} value={appealText} maxLength={4000} onChange={(e) => setAppealText(e.target.value)} />
              </Field>
              <button className="btn-primary mt-3 w-full" disabled={appealText.trim().length < 10} onClick={() => { setError(null); setConfirm('appeal') }}>Submit appeal</button>
            </Card>
          )}
          <Card>
            <CardHeader title="Need to raise something else?" />
            <Link to={`/citizen/complaints/new${c.project_id ? `?project=${c.project_id}` : ''}`} className="btn-secondary w-full">Submit another complaint</Link>
          </Card>
        </div>
      </div>

      <ConfirmDialog open={confirm === 'feedback'} title="Submit your feedback?" busy={busy}
        message={`You are saying you are ${satisfied ? 'satisfied' : 'NOT satisfied'} with the resolution. ${satisfied ? 'The complaint will be closed.' : 'You can then file an appeal.'} Feedback cannot be changed afterwards.`}
        confirmLabel="Submit feedback" tone={satisfied ? 'success' : 'warn'} onCancel={() => setConfirm(null)}
        onConfirm={() => act({ action: 'feedback', satisfied, rating: rating || null, text: fbText.trim() || null }, 'Thank you for your feedback.')}>
        <ErrorBanner error={actError} className="mt-3" />
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'appeal'} title="Submit your appeal?" busy={busy}
        message="Your appeal will be sent to the Head Officer for review. You can only appeal once."
        confirmLabel="Submit appeal" onCancel={() => setConfirm(null)}
        onConfirm={() => act({ action: 'appeal', text: appealText.trim() }, 'Your appeal was submitted.')}>
        <ErrorBanner error={actError} className="mt-3" />
      </ConfirmDialog>
    </>
  )
}
