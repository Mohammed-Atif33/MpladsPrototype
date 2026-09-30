import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Send } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { Card, EmptyState, ErrorBanner, Field, PageHeader, Spinner, StatusBadge, Textarea, useAction, useApi, useToast } from '../../components/ui'

const FILTERS = [['Open', 'Awaiting response'], ['Responded', 'Responded'], ['', 'All']]
const today = () => new Date().toISOString().slice(0, 10)

function ClarificationCard({ c, onDone }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const overdue = c.status === 'Open' && c.due_date && c.due_date < today()
  const [send, { busy, error }] = useAction(async () => {
    await api.put(`/api/clarifications/${c.clarification_id}/respond`, { response: text.trim() })
    toast('Response sent to the officer.')
    setText('')
    onDone()
  })
  return (
    <Card className={overdue ? 'border-red-300' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link to={`/agency/projects/${c.project_id}`} className="font-semibold text-navy-800 hover:underline">{c.project_name}</Link>
          <div className="text-xs text-slate-400">{c.project_code} · asked by {c.requested_by || 'officer'} on {fmtDate(c.created_at)}</div>
        </div>
        <div className="flex items-center gap-2">
          {c.due_date && <span className={`pill ${overdue ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-600'}`}><Clock className="h-3 w-3" /> {overdue ? 'Overdue - ' : 'Due '}{fmtDate(c.due_date)}</span>}
          <StatusBadge status={c.status} />
        </div>
      </div>
      <div className="mt-3 rounded-md bg-slate-50 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Officer’s question</div><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{c.question}</p></div>
      {c.status === 'Open' ? (
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) send() }}>
          <ErrorBanner error={error} className="mb-2" />
          <Field label="Your response" required><Textarea rows={3} value={text} maxLength={3000} onChange={(e) => setText(e.target.value)} placeholder="Provide the requested explanation or details…" /></Field>
          <button className="btn-primary mt-2" disabled={busy || text.trim().length < 3}><Send className="h-4 w-4" /> {busy ? 'Sending…' : 'Send response'}</button>
        </form>
      ) : (
        <div className="mt-3 rounded-md bg-green-50 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-green-700">Your response ({fmtDateTime(c.responded_at)})</div><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{c.response}</p></div>
      )}
    </Card>
  )
}

export default function AgencyClarifications() {
  const [status, setStatus] = useState('Open')
  const { data, loading, error, reload } = useApi(() => api.get('/api/clarifications', { status }), [status])
  const rows = data || []
  return (
    <>
      <PageHeader title="Clarifications" subtitle="Questions from the reviewing officer about your projects." />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([v, l]) => <button key={l} onClick={() => setStatus(v)} className={`pill ${status === v ? 'bg-navy-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{l}</button>)}
      </div>
      <ErrorBanner error={error} onRetry={reload} className="mb-4" />
      {loading && !data ? <Spinner /> : rows.length === 0
        ? <Card><EmptyState title={status === 'Open' ? 'No clarifications waiting for you' : 'No clarifications found'} /></Card>
        : <div className="space-y-4">{rows.map((c) => <ClarificationCard key={c.clarification_id} c={c} onDone={reload} />)}</div>}
    </>
  )
}
