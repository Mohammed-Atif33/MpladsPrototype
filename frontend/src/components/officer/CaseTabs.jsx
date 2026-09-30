import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Star } from 'lucide-react'
import { api } from '../../lib/api'
import { RISK_COLOURS } from '../../lib/nav'
import { fmtDate, fmtDateTime, inr, inrFull } from '../../lib/format'
import {
  Card, CardHeader, DataTable, DocumentRow, EmptyState, ErrorBanner, KeyValue, Notice, Pill, ProgressBar, RiskBadge, Spinner, Stat, StatusBadge, useApi,
} from '../ui'
import { AuditTable } from './common'

const NAVY = '#3b649a'
const SLATE = '#94a3b8'

function Loading({ state }) {
  if (state.loading && !state.data) return <Spinner />
  if (state.error) return <ErrorBanner error={state.error} onRetry={state.reload} />
  return null
}

// ------------------------------------------------------------------ 1. risk factors
export function RiskFactorsTab({ risk }) {
  const latest = risk?.latest
  if (!latest) return <EmptyState title="Not analysed yet" hint="Run the risk analysis to see the contributing factors." />
  const drivers = latest.historical_comparison?.anomaly?.drivers || []
  const factors = latest.contributing_factors || []
  return (
    <div className="space-y-5">
      <Notice tone={latest.risk_level === 'Low' ? 'green' : 'orange'}>
        <b>{latest.recommendation}</b>
      </Notice>

      <Card>
        <CardHeader title="Explainable risk factors" subtitle={`Each bar is the factor's contribution to the ${Number(latest.risk_score).toFixed(1)}/100 score; the factors add up to the score.`} />
        <div className="grid gap-3 sm:grid-cols-3 mb-4">
          <Stat label="Rule-based score" value={latest.rule_score != null ? `${Number(latest.rule_score).toFixed(1)}/100` : '—'} sub="weighted rule checks" />
          <Stat label="Anomaly score (Isolation Forest)" value={latest.anomaly_score != null ? `${Number(latest.anomaly_score).toFixed(0)}/100` : 'unavailable'} sub="percentile vs historical projects" />
          <Stat label="Model / rule version" value={<span className="text-xs">{latest.model_version}</span>} sub={`Analysed ${fmtDateTime(latest.timestamp)}`} />
        </div>
        <ul className="divide-y divide-slate-100">
          {factors.map((f) => {
            const w = f.max_points > 0 ? Math.min(100, (f.points / f.max_points) * 100) : 0
            const hot = f.contributing
            return (
              <li key={f.key} className={clsx('py-3', !hot && 'opacity-60')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{f.label}</span>
                    <Pill tone={hot ? (f.severity >= 0.6 ? 'orange' : 'yellow') : 'slate'}>{f.signal}</Pill>
                  </div>
                  <div className="text-sm tabular-nums text-slate-600"><b>{f.points.toFixed(1)}</b> / {f.max_points.toFixed(1)} pts</div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full" style={{ width: `${w}%`, background: f.severity >= 0.75 ? RISK_COLOURS.Critical : f.severity >= 0.5 ? RISK_COLOURS.High : f.severity >= 0.25 ? RISK_COLOURS.Medium : RISK_COLOURS.Low }} />
                </div>
                <p className="mt-1.5 text-sm text-slate-600">{f.detail}</p>
              </li>
            )
          })}
        </ul>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Anomaly detection drivers" subtitle="Features where this project deviates most from the historical database" />
          {latest.anomaly_score == null ? <EmptyState title="Anomaly detection unavailable" hint="Not enough historical projects." /> : drivers.length === 0
            ? <p className="text-sm text-slate-500">No single feature stands out from the historical range.</p> : (
              <ul className="space-y-2 text-sm">
                {drivers.map((d) => (
                  <li key={d.feature} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
                    <span className="capitalize">{d.label}</span>
                    <span className="text-slate-600">{d.value} <span className="text-slate-400">vs historical median {d.historical_median}</span></span>
                  </li>
                ))}
              </ul>
            )}
        </Card>
        <Card>
          <CardHeader title="Payment pattern observations" />
          {(latest.payment_flags || []).length === 0 ? <p className="text-sm text-slate-500">No unusual payment pattern found in the payment schedule.</p> : (
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">{latest.payment_flags.map((p, i) => <li key={i}>Further verification recommended: {p}.</li>)}</ul>
          )}
        </Card>
      </div>

      {(risk.history || []).length > 1 && (
        <Card pad={false}>
          <div className="p-4 pb-2"><CardHeader title="Analysis history" /></div>
          <DataTable rows={risk.history} rowKey={(r) => r.risk_id} columns={[
            { key: 'timestamp', header: 'When', render: (r) => fmtDateTime(r.timestamp) },
            { key: 'risk', header: 'Risk', render: (r) => <RiskBadge level={r.risk_level} score={r.risk_score} /> },
            { key: 'rule_score', header: 'Rule score', render: (r) => r.rule_score?.toFixed?.(1) ?? '—' },
            { key: 'anomaly_score', header: 'Anomaly score', render: (r) => r.anomaly_score?.toFixed?.(0) ?? '—' },
            { key: 'model_version', header: 'Model' },
          ]} />
        </Card>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ 2. historical comparison
function ChartCard({ title, subtitle, children }) {
  return <Card><CardHeader title={title} subtitle={subtitle} /><div className="h-64">{children}</div></Card>
}

function Compare({ label, current, baseline, hint, warn }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={clsx('text-xl font-semibold', warn ? 'text-orange-600' : 'text-slate-900')}>{current}</span>
        <span className="text-sm text-slate-500">vs {baseline}</span>
      </div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  )
}

export function HistoricalTab({ projectId }) {
  const st = useApi(() => api.get(`/api/projects/${projectId}/historical-comparison`), [projectId])
  const l = Loading({ state: st })
  if (l) return l
  const c = st.data.comparison
  if (!c || c.insufficient_history) return <EmptyState title="Not enough historical data" hint="No historical projects are available for comparison." />
  const ap = c.agency_performance
  const ch = c.charts || {}
  const colours = { 'Planned / expected': SLATE, Actual: NAVY, 'Similar projects at this stage': SLATE, 'This project': NAVY }
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Comparison with the historical database" subtitle={`${c.history_size} historical/verified projects searched · ${st.data.source}`} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Compared projects" value={c.compared_projects} sub={`peer group: ${c.peer_count}`} />
          <Stat label="Same agency" value={c.same_agency} />
          <Stat label="Same category" value={c.same_category} />
          <Stat label="Same district" value={c.same_district} />
          <Stat label="Similar budget" value={c.similar_budget} />
          <Stat label="Similar duration" value={c.similar_duration} />
          <Stat label="Similar size" value={c.similar_size} />
          <Stat label="Similar progress stage" value={c.similar_progress_stage} />
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Compare label="Current delay" current={`${c.current_delay} days`} baseline={`${c.peer_avg_delay} days (similar-project average)`} warn={c.current_delay > c.peer_avg_delay * 1.5}
          hint={`${c.similar_previous_delays} similar projects were delayed > 90 days`} />
        <Compare label="Current progress" current={`${c.current_progress}%`} baseline={`${c.expected_progress ?? '—'}% expected`} warn={c.expected_progress != null && c.expected_progress - c.current_progress > 15} />
        <Compare label="Current expenditure" current={`${c.current_spend_ratio}%`} baseline={`${c.avg_spend_ratio_at_stage}% at a similar stage`} warn={c.current_spend_ratio - c.avg_spend_ratio_at_stage > 10}
          hint={`based on ${c.stage_sample_size} similar-stage records`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Planned vs Actual Progress" subtitle="% complete">
          <ResponsiveContainer width="100%" height="100%"><BarChart data={ch.progress || []}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} /><Tooltip formatter={(v) => `${v}%`} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>{(ch.progress || []).map((d) => <Cell key={d.label} fill={colours[d.label] || NAVY} />)}</Bar></BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Planned vs Actual Expenditure" subtitle="% of sanctioned amount spent">
          <ResponsiveContainer width="100%" height="100%"><BarChart data={ch.expenditure || []}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} /><Tooltip formatter={(v) => `${v}%`} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>{(ch.expenditure || []).map((d) => <Cell key={d.label} fill={colours[d.label] || NAVY} />)}</Bar></BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Historical Average vs Current Project" subtitle="Similar-project average compared with this project">
          <ResponsiveContainer width="100%" height="100%"><BarChart data={ch.hist_vs_current || []}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="metric" tick={{ fontSize: 11 }} /><YAxis /><Tooltip /><Legend />
            <Bar dataKey="historical" name="Historical average" fill={SLATE} radius={[4, 4, 0, 0]} /><Bar dataKey="current" name="This project" fill="#f97316" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Agency Delay History" subtitle="Delay (days) of the agency's other projects">
          {(c.agency_delay_history || []).length === 0 ? <EmptyState title="No agency history" /> : (
            <ResponsiveContainer width="100%" height="100%"><BarChart data={c.agency_delay_history}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="project_code" tick={false} /><YAxis /><Tooltip />
              <ReferenceLine y={c.peer_avg_delay} stroke="#16a34a" strokeDasharray="4 4" label={{ value: 'similar avg', fontSize: 10, fill: '#16a34a' }} />
              <ReferenceLine y={c.current_delay} stroke="#dc2626" strokeDasharray="4 4" label={{ value: 'this project', fontSize: 10, fill: '#dc2626' }} />
              <Bar dataKey="delay_days" name="Delay (days)" fill={NAVY} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {ap && (
        <Card>
          <CardHeader title="Previous agency performance" subtitle={ap.name} />
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Past projects" value={ap.total_projects} />
            <Stat label="Delayed" value={`${ap.delayed_projects} (${Math.round((ap.delayed_ratio || 0) * 100)}%)`} />
            <Stat label="Average delay" value={`${ap.average_delay} d`} sub={`all projects ${c.global_avg_delay} d`} />
            <Stat label="Previous high-risk" value={ap.previous_high_risk_cases} />
            <Stat label="Complaints" value={ap.complaints} />
            <Stat label="Performance score" value={`${ap.historical_performance}/100`} />
          </div>
        </Card>
      )}

      <Card pad={false}>
        <div className="p-4 pb-2"><CardHeader title="Most similar historical projects" /></div>
        <DataTable rows={c.similar_projects || []} rowKey={(r) => r.project_code} columns={[
          { key: 'project_code', header: 'Project', render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-slate-500">{r.project_code} · {r.category} · {r.district}</div></div> },
          { key: 'sanctioned_amount', header: 'Budget', render: (r) => inr(r.sanctioned_amount) },
          { key: 'delay_days', header: 'Delay', render: (r) => `${r.delay_days} d` },
          { key: 'progress', header: 'Progress', render: (r) => `${r.progress}%` },
          { key: 'spend_ratio', header: 'Spent', render: (r) => `${r.spend_ratio}%` },
          { key: 'similarity', header: 'Similarity', render: (r) => `${Math.round(r.similarity * 100)}%` },
        ]} />
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ 3. extracted data
export function ExtractedTab({ p }) {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Project" />
        <KeyValue items={[
          ['Project ID', p.project_code], ['Name', p.name], ['Category', p.category], ['Location', p.location], ['District', p.district],
          ['Constituency', p.constituency], ['Agency', p.agency_name || p.agency], ['Published to citizens', p.is_public ? 'Yes' : 'No'],
          ['Description', p.description],
        ]} />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Financial" />
          <KeyValue items={[
            ['Sanctioned amount', inrFull(p.sanctioned_amount)], ['Released amount', inrFull(p.released_amount)], ['Expenditure', inrFull(p.expenditure)],
            ['Remaining amount', inrFull(p.remaining_amount)], ['Budget revisions', p.budget_revisions],
          ]} />
        </Card>
        <Card>
          <CardHeader title="Timeline & progress" />
          <KeyValue items={[
            ['Sanction date', fmtDate(p.sanction_date)], ['Start date', fmtDate(p.start_date)], ['Original deadline', fmtDate(p.deadline)],
            ['Revised deadline', fmtDate(p.revised_deadline)], ['Completion date', fmtDate(p.completion_date)], ['Delay', `${p.delay_days} days`],
            ['Extension requests', p.extension_requests], ['Reporting period', p.reporting_period],
            ['Actual progress', `${p.progress}%`], ['Planned progress', p.planned_progress != null ? `${p.planned_progress}%` : '—'],
          ]} />
          <div className="mt-3"><ProgressBar value={p.progress} planned={p.planned_progress} /></div>
        </Card>
      </div>
      <Card pad={false}>
        <div className="p-4 pb-2"><CardHeader title="Payments" /></div>
        <DataTable rows={p.payments || []} rowKey={(r) => r.payment_id} empty={<EmptyState title="No payments recorded" />} columns={[
          { key: 'paid_on', header: 'Date', render: (r) => fmtDate(r.paid_on) },
          { key: 'amount', header: 'Amount', render: (r) => inrFull(r.amount) },
          { key: 'description', header: 'Description' }, { key: 'reference', header: 'Reference' },
        ]} />
      </Card>
      <Card pad={false}>
        <div className="p-4 pb-2"><CardHeader title="Milestones" /></div>
        <DataTable rows={p.milestones || []} rowKey={(r) => r.milestone} empty={<EmptyState title="No milestones recorded" />} columns={[
          { key: 'milestone', header: 'Milestone' }, { key: 'planned', header: 'Planned' },
          { key: 'actual', header: 'Actual / status', render: (r) => r.actual || r.status || '—' },
        ]} />
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ 4. documents
export function DocumentsTab({ p }) {
  const docs = p.documents || []
  return (
    <Card>
      <CardHeader title="Source documents" subtitle="The verified project PDF and files uploaded by the agency or officers" />
      {docs.length === 0 ? <EmptyState title="No documents" /> : <ul className="space-y-2">{docs.map((d) => <DocumentRow key={d.document_id} doc={d} />)}</ul>}
    </Card>
  )
}

// ------------------------------------------------------------------ 5. agency history
export function AgencyTab({ projectId, base }) {
  const st = useApi(() => api.get(`/api/projects/${projectId}/agency-history`), [projectId])
  const l = Loading({ state: st })
  if (l) return l
  const a = st.data.agency
  if (!a) return <EmptyState title="No implementing agency recorded" />
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={a.name} subtitle="Historical performance of the implementing agency (excluding this project's own analysis)" />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Total projects" value={a.total_projects} />
          <Stat label="Completed" value={a.completed_projects} />
          <Stat label="Delayed (> 30 d)" value={a.delayed_projects} />
          <Stat label="Average delay" value={`${a.average_delay} days`} />
          <Stat label="Performance score" value={`${a.historical_performance}/100`} />
          <Stat label="Complaints" value={a.complaints} />
          <Stat label="Inspections" value={a.inspections} sub={`${a.adverse_inspections} with adverse findings`} />
          <Stat label="Previous high-risk cases" value={a.previous_high_risk_cases} />
        </div>
      </Card>
      <Card pad={false}>
        <div className="p-4 pb-2"><CardHeader title="Other projects by this agency" /></div>
        <DataTable rows={st.data.projects} rowKey={(r) => r.project_id} empty={<EmptyState title="No other projects" />} columns={[
          { key: 'name', header: 'Project', render: (r) => <Link className="font-medium text-navy-700 hover:underline" to={`${base}/projects/${r.project_id}`}>{r.name}<div className="text-xs font-normal text-slate-500">{r.project_code} · {r.category}</div></Link> },
          { key: 'delay_days', header: 'Delay', render: (r) => `${r.delay_days} d` },
          { key: 'progress', header: 'Progress', render: (r) => `${r.progress}%` },
          { key: 'risk_level', header: 'Risk', render: (r) => <RiskBadge level={r.risk_level} /> },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ]} />
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ 6. citizen feedback
export function FeedbackTab({ projectId, base }) {
  const st = useApi(() => api.get(`/api/projects/${projectId}/feedback`), [projectId])
  const l = Loading({ state: st })
  if (l) return l
  const { reviews, complaints } = st.data
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Citizen reviews" subtitle={avg ? `${avg.toFixed(1)} / 5 average from ${reviews.length} review(s)` : undefined} />
        {reviews.length === 0 ? <EmptyState title="No reviews yet" /> : (
          <ul className="divide-y divide-slate-100">
            {reviews.map((r) => (
              <li key={r.review_id} className="py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="flex">{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={clsx('h-3.5 w-3.5', n <= r.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />)}</span>
                  <span className="text-slate-500">{r.author} · {fmtDate(r.created_at)}</span>
                </div>
                {r.comment && <p className="mt-1 text-sm text-slate-700">{r.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card pad={false}>
        <div className="flex items-center justify-between p-4 pb-2">
          <CardHeader title="Complaints" subtitle="Only screened / verified complaints carry significant weight in the risk analysis" />
          <Link to={`${base}/complaints`} className="text-sm text-navy-700 hover:underline">Complaint management →</Link>
        </div>
        <DataTable rows={complaints} rowKey={(r) => r.complaint_id} empty={<EmptyState title="No complaints" />} columns={[
          { key: 'tracking_id', header: 'Tracking ID', render: (r) => <span className="font-mono text-xs">{r.tracking_id}</span> },
          { key: 'category', header: 'Complaint', render: (r) => <div className="max-w-sm"><div className="font-medium">{r.category}{r.serious && <span className="ml-2 pill bg-red-100 text-red-800"><AlertTriangle className="h-3 w-3" /> serious</span>}</div><div className="text-xs text-slate-600 line-clamp-2">{r.description}</div></div> },
          { key: 'citizen', header: 'Citizen' },
          { key: 'screening_status', header: 'Screening', render: (r) => <StatusBadge status={r.screening_status} /> },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'created_at', header: 'Filed', render: (r) => fmtDate(r.created_at) },
        ]} />
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ 7. audit
export function AuditTab({ projectId }) {
  const st = useApi(() => api.get('/api/audit-logs', { project_id: projectId, page_size: 100 }), [projectId])
  const [showSystem, setShowSystem] = useState(false)
  const l = Loading({ state: st })
  if (l) return l
  const notes = st.data.items.filter((r) => r.action === 'Notification').length
  const rows = showSystem ? st.data.items : st.data.items.filter((r) => r.action !== 'Notification')
  return (
    <Card pad={false}>
      <div className="p-4 pb-2">
        <CardHeader title="Audit trail" subtitle={`${st.data.total} record(s) for this project. Records are append-only and hash-chained.`}
          actions={notes > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
              Show system notification events ({notes})
            </label>
          )} />
      </div>
      <AuditTable rows={rows} />
    </Card>
  )
}
