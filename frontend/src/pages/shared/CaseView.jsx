import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, Bell, Gavel, ListChecks, PlayCircle, RefreshCw, UserCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { ROLE, useBasePath } from '../../lib/nav'
import { fmtDate, fmtDateTime, inr, pct } from '../../lib/format'
import {
  Card, CardHeader, ConfirmDialog, EmptyState, ErrorBanner, Field, Modal, Notice, PageHeader,
  PriorityBadge, ProgressBar, RiskBadge, Select, Spinner, Stat, StatusBadge, Tabs, Textarea,
  useApi, useToast,
} from '../../components/ui'
import DecisionDialog from '../../components/officer/DecisionDialog'
import { AgencyTab, AuditTab, DocumentsTab, ExtractedTab, FeedbackTab, HistoricalTab, RiskFactorsTab } from '../../components/officer/CaseTabs'

const TAB_KEYS = ['risk', 'comparison', 'extracted', 'documents', 'agency', 'feedback', 'audit']

function DecisionTimeline({ items }) {
  if (!items?.length) return <EmptyState title="No decisions recorded yet" />
  return (
    <ol className="space-y-3">
      {items.map((d) => (
        <li key={d.decision_id} className="relative border-l-2 border-navy-200 pl-4">
          <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-navy-600" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <b>{d.decision}</b><span className="text-slate-500">by {d.made_by} ({d.role})</span>
            <span className="text-xs text-slate-400">{fmtDateTime(d.created_at)}</span>
          </div>
          <p className="mt-0.5 text-sm text-slate-700">{d.reason}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            {(d.evidence_reviewed || []).map((e) => <span key={e} className="pill bg-slate-100 text-slate-600">{e}</span>)}
            {d.follow_up_date && <span>Follow-up {fmtDate(d.follow_up_date)}</span>}
            {d.action && <span>· {d.action}</span>}
          </div>
          {d.previous_status !== d.new_status && (
            <div className="mt-1 flex items-center gap-1.5 text-xs"><StatusBadge status={d.previous_status} /><ArrowRight className="h-3 w-3 text-slate-400" /><StatusBadge status={d.new_status} /></div>
          )}
        </li>
      ))}
    </ol>
  )
}

export default function CaseView() {
  const { id } = useParams()
  const { user } = useAuth()
  const base = useBasePath()
  const toast = useToast()
  const isHead = user.role === ROLE.HEAD
  const canOperate = user.role === ROLE.OFFICER || user.role === ROLE.HEAD
  const [sp, setSp] = useSearchParams()
  const tab = TAB_KEYS.includes(sp.get('tab')) ? sp.get('tab') : 'risk'
  const fresh = sp.get('fresh') === '1'

  const project = useApi(() => api.get(`/api/projects/${id}`), [id])
  const risk = useApi(() => api.get(`/api/projects/${id}/risk`), [id])
  const decisions = useApi(() => api.get('/api/decisions', { project_id: id }), [id])
  const inspections = useApi(() => api.get('/api/inspections', { project_id: id }), [id])
  const clar = useApi(() => api.get('/api/clarifications'), [id])

  const [decisionOpen, setDecisionOpen] = useState(false)
  const [analyzeOpen, setAnalyzeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const reloadAll = () => { project.reload(); risk.reload(); decisions.reload(); inspections.reload(); clar.reload() }
  const setTab = (t) => { const n = new URLSearchParams(sp); n.set('tab', t); setSp(n, { replace: true }) }

  if (project.loading && !project.data) return <Spinner />
  if (project.error && !project.data) return <ErrorBanner error={project.error} onRetry={project.reload} />
  const p = project.data
  const latest = risk.data?.latest
  const openInsp = (inspections.data || []).filter((i) => i.status !== 'Closed')
  const openClar = (clar.data || []).filter((c) => c.project_id === p.project_id && c.status === 'Open')

  const analyze = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await api.post(`/api/projects/${id}/risk-analysis`)
      toast(`Analysis complete: ${res.risk.risk_score}/100 (${res.risk.risk_level}).`)
      setAnalyzeOpen(false); reloadAll()
    } catch (e) { setErr(e); setAnalyzeOpen(false) } finally { setBusy(false) }
  }

  const tabs = [
    { key: 'risk', label: 'Risk Factors' }, { key: 'comparison', label: 'Historical Comparison' }, { key: 'extracted', label: 'Extracted Data' },
    { key: 'documents', label: 'Source Documents', count: p.documents?.length }, { key: 'agency', label: 'Agency History' },
    { key: 'feedback', label: 'Citizen Feedback', count: (p.complaint_counts?.verified || 0) + (p.complaint_counts?.pending || 0) || undefined },
    { key: 'audit', label: 'Audit Trail' },
  ]

  return (
    <>
      <PageHeader
        back={{ to: `${base}/projects`, label: 'Projects' }}
        title={p.name}
        subtitle={`${p.project_code} · ${p.agency_name || p.agency || 'No agency'} · ${p.location || p.district}`}
        actions={<>
          {canOperate && (
            <>
              <button className="btn-secondary" onClick={() => { setErr(null); setAnalyzeOpen(true) }}><RefreshCw className="h-4 w-4" /> {latest ? 'Re-run analysis' : 'Run analysis'}</button>
              <button className="btn-primary" onClick={() => setDecisionOpen(true)} disabled={!latest} title={latest ? '' : 'Run the analysis first'}>
                <Gavel className="h-4 w-4" /> {isHead ? 'Supervisory action' : 'Record decision'}
              </button>
            </>
          )}
          {user.role === ROLE.MP && (
            <Link to="/mp/assignments" className="btn-secondary">
              <ListChecks className="h-4 w-4" /> Reassign Stakeholders
            </Link>
          )}
        </>}
      />

      {fresh && (
        <Notice tone="green" className="mb-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <b>Data verified and stored. Analysis complete.</b>
            <span className="inline-flex items-center gap-1 text-green-700"><Bell className="h-3.5 w-3.5" /> Notifications were sent (check the bell). Review the factors below and record your decision.</span>
          </div>
        </Notice>
      )}
      <ErrorBanner error={err || risk.error} className="mb-4" />

      <Card className="mb-5">
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:border-r lg:border-slate-200 lg:pr-5">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Risk Score</div>
            {latest ? (
              <>
                <div className="mt-1 flex flex-wrap items-end gap-3">
                  <div className="text-5xl font-bold leading-none text-slate-900">{Number(latest.risk_score).toFixed(0)}<span className="text-2xl font-medium text-slate-400">/100</span></div>
                  <RiskBadge level={latest.risk_level} className="!text-sm !px-3 !py-1" />
                </div>
                <div className="mt-3 flex items-center gap-2 text-sm"><span className="text-slate-500">Status:</span><StatusBadge status={p.status} /></div>
                <div className="mt-1 text-xs text-slate-400">Analysed {fmtDateTime(latest.timestamp)}</div>
              </>
            ) : (
              <div className="mt-2 space-y-3">
                <div className="text-sm text-slate-600">This project has not been analysed yet.</div>
                <div className="flex items-center gap-2 text-sm"><span className="text-slate-500">Status:</span><StatusBadge status={p.status} /></div>
                {canOperate && <button className="btn-primary" onClick={() => setAnalyzeOpen(true)}><PlayCircle className="h-4 w-4" /> Run analysis</button>}
              </div>
            )}
          </div>
          <div className="lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-4">
              <Stat label="Budget" value={inr(p.sanctioned_amount)} sub={`spent ${inr(p.expenditure)}`} />
              <Stat label="Progress" value={pct(p.progress)} sub={p.planned_progress != null ? `expected ${pct(p.planned_progress)}` : undefined} />
              <Stat label="Delay" value={`${p.delay_days} days`} sub={`deadline ${fmtDate(p.revised_deadline || p.deadline)}`} />
              <Stat label="Revisions / extensions" value={`${p.budget_revisions} / ${p.extension_requests}`} sub={`${p.complaint_counts?.verified ?? 0} verified complaint(s)`} />
            </div>
            <div className="mt-3"><ProgressBar value={p.progress} planned={p.planned_progress} /></div>
            {(openInsp.length > 0 || openClar.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {openInsp.map((i) => <Link key={i.inspection_id} to={`${base}/inspections`} className="pill bg-orange-100 text-orange-800">Inspection #{i.inspection_id}: {i.status} <PriorityBadge priority={i.priority} /></Link>)}
                {openClar.map((c) => <span key={c.clarification_id} className="pill bg-orange-100 text-orange-800" title={c.question}>Open clarification (due {fmtDate(c.due_date)})</span>)}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 space-y-2 border-t border-slate-200 pt-3">
          <Notice tone="yellow">{risk.data?.threshold_notice || 'Prototype risk thresholds - not official government thresholds.'} (0–29 Low · 30–59 Medium · 60–79 High · 80–100 Critical)</Notice>
          <p className="text-xs text-slate-500">{risk.data?.disclaimer || 'A risk score is an investigation / prioritisation signal, not proof of wrongdoing.'}</p>
        </div>
      </Card>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="mt-5">
        {tab === 'risk' && (
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="xl:col-span-2">{risk.loading && !risk.data ? <Spinner /> : <RiskFactorsTab risk={risk.data} />}</div>
            <Card className="h-fit">
              <CardHeader title="Decision history" icon={Gavel} subtitle="Decisions and supervisory actions on this case" />
              {decisions.loading && !decisions.data ? <Spinner /> : <DecisionTimeline items={decisions.data} />}
            </Card>
          </div>
        )}
        {tab === 'comparison' && <HistoricalTab projectId={id} />}
        {tab === 'extracted' && <ExtractedTab p={p} />}
        {tab === 'documents' && <DocumentsTab p={p} />}
        {tab === 'agency' && <AgencyTab projectId={id} base={base} />}
        {tab === 'feedback' && <FeedbackTab projectId={id} base={base} />}
        {tab === 'audit' && <AuditTab projectId={id} />}
      </div>

      <DecisionDialog open={decisionOpen} onClose={() => setDecisionOpen(false)} project={p} role={user.role} onDone={reloadAll} />
      <ConfirmDialog open={analyzeOpen} busy={busy} title={latest ? 'Re-run risk analysis?' : 'Run risk analysis?'} confirmLabel="Run analysis"
        message="The hybrid rule-based + Isolation Forest analysis will run on the verified data and the result will be stored and audited. Officers are notified."
        onCancel={() => setAnalyzeOpen(false)} onConfirm={analyze} />
    </>
  )
}
