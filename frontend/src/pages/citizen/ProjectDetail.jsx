import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowRight, Building2, CalendarClock, CalendarDays, Camera,
  CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Clock, Eye,
  FileCheck2, FileText, Gavel, Info, Landmark, MapPin, Maximize2,
  MessageSquareWarning, ShieldAlert, ShieldCheck, UserCheck,
} from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDate, fmtDateTime, inr, inrFull, timeAgo } from '../../lib/format'
import {
  AuthImage, Card, CardHeader, DocumentRow, EmptyState, ErrorBanner, Field,
  KeyValue, MapView, Modal, Notice, PageHeader, ProgressBar, RiskBadge, Spinner,
  StatusBadge, Textarea, useAction, useApi, useToast,
} from '../../components/ui'
import { StarInput, Stars } from '../../components/portal/Stars'

const RISK_LEVEL_COLORS = {
  Low: 'text-green-700 bg-green-50 border-green-200',
  Medium: 'text-yellow-700 bg-yellow-50 border-yellow-200',
  High: 'text-orange-700 bg-orange-50 border-orange-200',
  Critical: 'text-red-700 bg-red-50 border-red-200',
}

const RISK_LEVEL_BG = {
  Low: 'bg-green-500',
  Medium: 'bg-yellow-500',
  High: 'bg-orange-500',
  Critical: 'bg-red-600',
}

export default function CitizenProjectDetail() {
  const { id } = useParams()
  const toast = useToast()
  const project = useApi(() => api.get(`/api/projects/${id}`), [id])
  const reviews = useApi(() => api.get(`/api/projects/${id}/reviews`), [id])
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [zoom, setZoom] = useState(null)
  const [galleryItem, setGalleryItem] = useState(null)
  const [selectedInspId, setSelectedInspId] = useState(null)

  const [submit, { busy, error, setError }] = useAction(async () => {
    await api.post(`/api/projects/${id}/reviews`, { rating, comment: comment.trim() || null })
    toast('Thank you - your review was published.')
    setRating(0); setComment('')
    reviews.reload(); project.reload()
  })

  if (project.loading && !project.data) return <Spinner />
  if (project.error) return <><PageHeader title="Project" back={{ to: '/citizen/projects', label: 'All projects' }} /><ErrorBanner error={project.error} onRetry={project.reload} /></>
  const p = project.data
  if (!p) return null

  const spent = p.sanctioned_amount ? (p.expenditure / p.sanctioned_amount) * 100 : 0
  const photos = (p.documents || []).filter((d) => (d.content_type || '').startsWith('image/'))
  const others = (p.documents || []).filter((d) => !(d.content_type || '').startsWith('image/'))

  const hasRisk = p.risk_score !== null && p.risk_score !== undefined
  const officerName = p.monitoring_officer_name || p.assigned_officer_name || p.officer_name || p.monitoring_officer || 'Not Assigned'
  const agencyName = p.agency_name || p.agency || 'Not Assigned'
  const initiatorName = p.project_initiator || p.mp_name || 'Member of Parliament'
  const currentStatus = p.public_status || p.status || 'Under Monitoring'
  const safeFactors = p.public_safe_risk_factors || []

  const inspections = p.inspections || []
  const reportInspections = inspections.filter((i) => i.has_report || ['Report Submitted', 'Action Pending', 'Completed', 'Closed'].includes(i.inspection_status || i.status))
  const scheduledInspections = inspections.filter((i) => (i.inspection_status || i.status) === 'Scheduled')
  const latestReport = reportInspections[0] || null
  const nextScheduled = scheduledInspections[0] || null
  const activeInsp = inspections.find((i) => i.inspection_id === selectedInspId) || latestReport || inspections[0] || null

  return (
    <>
      <PageHeader
        back={{ to: '/citizen/projects', label: 'All projects' }}
        title={p.name}
        subtitle={`${p.project_code} · ${p.category}`}
        actions={
          <Link to={`/citizen/complaints/new?project=${p.project_id}`} className="btn-warn">
            <MessageSquareWarning className="h-4 w-4" /> Report a problem / Submit complaint
          </Link>
        }
      />

      {/* SECTION 8: PUBLIC PROJECT HEADER TRANSPARENCY BAR */}
      <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 text-sm">
          <div>
            <span className="block text-xs font-medium uppercase tracking-wider text-slate-500">Project ID</span>
            <span className="font-mono font-semibold text-slate-900">{p.project_code}</span>
          </div>
          <div>
            <span className="block text-xs font-medium uppercase tracking-wider text-slate-500">Current Status</span>
            <div className="mt-0.5 flex items-center gap-1.5">
              <StatusBadge status={currentStatus} />
            </div>
          </div>
          <div>
            <span className="block text-xs font-medium uppercase tracking-wider text-slate-500">Risk Score & Level</span>
            <div className="mt-0.5 flex items-center gap-2">
              {hasRisk ? (
                <>
                  <span className="font-bold text-slate-900">{Number(p.risk_score).toFixed(0)} / 100</span>
                  <RiskBadge level={p.risk_level} />
                </>
              ) : (
                <span className="text-xs font-medium text-slate-500">Risk Analysis: Pending</span>
              )}
            </div>
          </div>
          <div>
            <span className="block text-xs font-medium uppercase tracking-wider text-slate-500">Implementing Agency</span>
            <span className="font-medium text-slate-800 truncate block" title={agencyName}>{agencyName}</span>
          </div>
          <div>
            <span className="block text-xs font-medium uppercase tracking-wider text-slate-500">Monitoring Officer</span>
            <span className="font-medium text-slate-800 truncate block" title={officerName}>{officerName}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left 2 Columns */}
        <div className="space-y-5 lg:col-span-2">
          {/* Main Project Overview Card */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={currentStatus} />
                {p.public_status === 'Delayed' && (
                  <span className="text-sm font-medium text-orange-700">
                    Behind original deadline by {p.delay_days} days
                  </span>
                )}
              </div>
              <Stars value={p.rating_avg} count={p.rating_count} />
            </div>

            <div className="mt-4">
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-slate-500">Physical Progress</span>
                <b className="text-slate-800">{p.progress}%</b>
              </div>
              <ProgressBar value={p.progress} />
              {p.planned_progress !== null && p.planned_progress !== undefined && (
                <div className="mt-1.5 flex justify-between text-xs text-slate-500">
                  <span>Planned / Expected Progress</span>
                  <span>{p.planned_progress}%</span>
                </div>
              )}
            </div>

            <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <span>{p.location}{p.district ? `, ${p.district}` : ''}{p.constituency ? ` (${p.constituency} constituency)` : ''}</span>
              </div>
              <div className="flex items-start gap-2">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <span>{agencyName}</span>
              </div>
            </div>
            {p.description && <p className="mt-4 text-sm leading-relaxed text-slate-700">{p.description}</p>}
          </Card>

          {/* SECTION 7: PROJECT RESPONSIBILITY SECTION */}
          <Card>
            <CardHeader
              title="Project Responsibility"
              subtitle="Designated public authorities and institutions responsible for execution and oversight"
              icon={UserCheck}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Project Initiated By</div>
                <div className="mt-1 font-semibold text-slate-900">{initiatorName}</div>
                <div className="text-xs text-slate-500">Initiating Authority (Member of Parliament)</div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Implementing Agency</div>
                <div className="mt-1 font-semibold text-slate-900">{agencyName}</div>
                <div className="text-xs text-slate-500">Role: Implementing Agency</div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Monitoring Officer</div>
                <div className="mt-1 font-semibold text-slate-900">{officerName}</div>
                <div className="text-xs text-slate-500">Role: Monitoring Officer</div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Current Project Status</div>
                <div className="mt-1 font-semibold text-slate-900 flex items-center gap-2">
                  <StatusBadge status={currentStatus} />
                </div>
                <div className="text-xs text-slate-500">Public oversight state</div>
              </div>
            </div>
          </Card>

          {/* SECTION 3, 4, 12, 13, 21: RISK TRANSPARENCY */}
          <Card>
            <CardHeader
              title="Risk Transparency & Signals"
              subtitle="Project monitoring signals derived from progress, financial records, and field reports"
              icon={ShieldAlert}
            />

            {/* Score & Level Display */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Calculated Risk Score</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    {hasRisk ? (
                      <>
                        <span className="text-3xl font-extrabold text-slate-900">{Number(p.risk_score).toFixed(0)}</span>
                        <span className="text-lg font-semibold text-slate-500">/ 100</span>
                      </>
                    ) : (
                      <span className="text-lg font-semibold text-slate-600">Risk Analysis: Pending / Not Yet Available</span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Risk Level</div>
                  {hasRisk && p.risk_level ? (
                    <RiskBadge level={p.risk_level} className="text-sm px-3 py-1" />
                  ) : (
                    <span className="pill bg-slate-200 text-slate-600 text-xs">Risk Analysis: Pending</span>
                  )}
                </div>
              </div>

              {p.risk_updated_at ? (
                <div className="mt-3 pt-3 border-t border-slate-200/80 flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Risk Last Updated: <b className="text-slate-700">{fmtDateTime(p.risk_updated_at)}</b></span>
                </div>
              ) : (
                <div className="mt-3 pt-3 border-t border-slate-200/80 flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Last Risk Update: <span className="text-slate-500 font-medium">Not available</span></span>
                </div>
              )}
            </div>

            {/* SECTION 4: Public-Safe Risk Factors */}
            <div className="mt-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">Observable Risk Factors</h4>
              {safeFactors.length > 0 ? (
                <ul className="space-y-2">
                  {safeFactors.map((factor, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-slate-700 rounded-md bg-amber-50/60 border border-amber-100 p-2.5">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                      <span className="font-medium">{typeof factor === 'string' ? factor : factor.label || factor.factor}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                  <span>{hasRisk ? 'No adverse risk factors identified. Project parameters are within standard thresholds.' : 'Risk assessment pending initial data verification.'}</span>
                </div>
              )}
            </div>

            {/* SECTION 3 & 21: Public Risk Explanations and Disclaimers */}
            <div className="mt-4 space-y-2.5">
              <div className="rounded-md bg-blue-50/80 border border-blue-200/80 p-3 text-xs text-blue-900 leading-relaxed">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
                  <div>
                    <p className="font-semibold">Understanding Risk Scores</p>
                    <p className="mt-0.5">
                      Risk score is an investigation and prioritization signal based on project progress, financial patterns, historical comparisons, delays, reports and other available project information.
                    </p>
                    <p className="mt-1 font-medium">Risk score does not prove fraud or wrongdoing.</p>
                  </div>
                </div>
              </div>

              <Notice tone="amber" className="text-xs">
                <b>Public Disclaimer:</b> Risk score is a project-monitoring and prioritization signal. It does not by itself establish fraud, misconduct, or wrongdoing.
              </Notice>
            </div>
          </Card>

          {/* SECTIONS 12 - 20: CITIZEN INSPECTION TRANSPARENCY & REPORTS */}
          <Card>
            <CardHeader
              title="Inspection Reports"
              subtitle="Official site inspections, verification findings, and photographic field evidence"
              icon={ClipboardCheck}
            />

            {inspections.length === 0 ? (
              <EmptyState
                title="Inspection report not yet submitted."
                hint="Official field inspection reports, verification findings, and photographs will appear here once conducted by designated monitoring officers."
              />
            ) : (
              <div className="space-y-5">
                {/* UPCOMING / SCHEDULED INSPECTION (Section 14) */}
                {nextScheduled && (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-2.5">
                      <div className="flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-indigo-700" />
                        <span className="font-semibold text-sm text-indigo-950">Upcoming Inspection</span>
                      </div>
                      <StatusBadge status="Scheduled" />
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2 text-xs">
                      <div>
                        <span className="text-slate-500 uppercase tracking-wider font-medium text-[11px]">Scheduled Date</span>
                        <div className="mt-0.5 font-semibold text-slate-900 text-sm">
                          {fmtDate(nextScheduled.scheduled_date || nextScheduled.inspection_date)}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 uppercase tracking-wider font-medium text-[11px]">Inspector</span>
                        <div className="mt-0.5 font-semibold text-slate-900 text-sm">
                          {nextScheduled.inspector_name || 'Assigned Officer'}
                        </div>
                        <div className="text-[11px] text-slate-500">Designated Field Inspector</div>
                      </div>
                    </div>

                    {nextScheduled.reason && (
                      <div className="mt-3 rounded-md bg-white/80 border border-indigo-100/80 p-2.5 text-xs text-slate-700">
                        <span className="font-semibold text-indigo-950">Purpose / Scope:</span>{' '}
                        <span>{nextScheduled.reason}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* ACTIVE / LATEST INSPECTION REPORT VIEW (Section 16 & 19) */}
                {activeInsp && (activeInsp.has_report || ['Report Submitted', 'Action Pending', 'Completed', 'Closed'].includes(activeInsp.inspection_status || activeInsp.status)) ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-navy-800">
                            {activeInsp.inspection_id === (reportInspections[0]?.inspection_id) ? 'Latest Inspection Report' : 'Inspection Report'}
                          </span>
                          <StatusBadge status={activeInsp.inspection_status || activeInsp.status} />
                          {activeInsp.public_outcome && (
                            <span className="pill bg-slate-200 text-slate-700 text-xs font-medium">
                              Outcome: {activeInsp.public_outcome}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Official site inspection conducted for project compliance and physical audit
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-xs text-slate-500">Inspection Date</div>
                        <div className="font-semibold text-slate-900 text-sm">
                          {fmtDate(activeInsp.inspection_date || activeInsp.completed_date || activeInsp.scheduled_date)}
                        </div>
                      </div>
                    </div>

                    {/* Inspector & Metadata (Section 15 & 16) */}
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 text-xs border-b border-slate-200/80 pb-3">
                      <div>
                        <span className="text-slate-500 uppercase tracking-wider font-medium text-[11px]">Inspector Name</span>
                        <div className="mt-0.5 font-semibold text-slate-900 text-sm">
                          {activeInsp.inspector_name || 'Assigned Officer'}
                        </div>
                        <div className="text-[11px] text-slate-500">Designated Monitoring Authority</div>
                      </div>
                      <div>
                        <span className="text-slate-500 uppercase tracking-wider font-medium text-[11px]">Inspection Status</span>
                        <div className="mt-0.5 flex items-center gap-1.5 font-semibold text-slate-900 text-sm">
                          <StatusBadge status={activeInsp.inspection_status || activeInsp.status} />
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {activeInsp.inspection_status === 'Action Pending'
                            ? 'Follow-up corrective action required'
                            : activeInsp.inspection_status === 'Closed'
                            ? (activeInsp.closure_date ? `Closed on ${fmtDate(activeInsp.closure_date)}` : 'Closed & verified')
                            : 'Verified & Documented'}
                        </div>
                      </div>
                    </div>

                    {/* Report Summary / Findings (Section 16) */}
                    <div className="mt-3.5 space-y-3">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5 flex items-center gap-1.5">
                          <FileCheck2 className="h-3.5 w-3.5 text-navy-700" />
                          <span>Report Summary & Public-Safe Observations</span>
                        </h4>
                        <div className="rounded-md bg-white border border-slate-200 p-3 text-xs leading-relaxed text-slate-800">
                          {activeInsp.public_findings || activeInsp.public_summary || (
                            <span className="text-slate-500 italic">Site inspection completed. Work verified against sanctioned specifications.</span>
                          )}
                        </div>
                      </div>

                      {/* Physical Progress Observed (if recorded) */}
                      {activeInsp.progress_observed !== null && activeInsp.progress_observed !== undefined && (
                        <div className="rounded-md bg-white border border-slate-200 p-2.5 text-xs text-slate-800 flex items-center justify-between">
                          <span className="font-semibold text-slate-700">Physical Progress Observed:</span>
                          <span className="font-bold text-navy-800">{activeInsp.progress_observed}%</span>
                        </div>
                      )}

                      {/* Issues Observed */}
                      {activeInsp.issues && (
                        <div className="rounded-md bg-amber-50/70 border border-amber-200/80 p-3 text-xs text-amber-950">
                          <div className="font-semibold mb-1 text-amber-900 flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-700" /> Issues Identified:
                          </div>
                          <div>{activeInsp.issues}</div>
                        </div>
                      )}

                      {activeInsp.public_recommendations && (
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                            Public-Safe Recommendations
                          </h4>
                          <div className="rounded-md bg-amber-50/70 border border-amber-200/80 p-3 text-xs leading-relaxed text-amber-950">
                            {activeInsp.public_recommendations}
                          </div>
                        </div>
                      )}

                      {/* Action Required & Responsible Party (Section 2 & 3) */}
                      {activeInsp.action_required && (
                        <div className="rounded-md bg-orange-50/80 border border-orange-200 p-3 text-xs text-orange-950">
                          <div className="font-semibold text-orange-900 flex items-center gap-1 mb-1">
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-700" /> Action Required:
                          </div>
                          <p>{activeInsp.action_required}</p>
                          {activeInsp.responsible_party && (
                            <div className="mt-1 text-slate-600 font-medium">
                              Responsible Party: <span className="text-slate-800 font-semibold">{activeInsp.responsible_party}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Current Action / Action Taken */}
                      {activeInsp.action_taken ? (
                        <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-950">
                          <div className="font-semibold text-emerald-900 flex items-center gap-1 mb-1">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" /> Action Taken:
                          </div>
                          <p>{activeInsp.action_taken}</p>
                          {activeInsp.action_date && (
                            <div className="mt-1 text-slate-500 text-[11px]">Action Date: {fmtDate(activeInsp.action_date)}</div>
                          )}
                        </div>
                      ) : (activeInsp.inspection_status === 'Action Pending' || activeInsp.status === 'Action Pending') ? (
                        <div className="rounded-md bg-slate-100 border border-slate-200 p-2.5 text-xs text-slate-700">
                          <span className="font-semibold text-slate-900">Current Action:</span>{' '}
                          <span>{activeInsp.current_action || 'Agency response / corrective action pending.'}</span>
                        </div>
                      ) : null}

                      {/* Closure Reason (when closed) */}
                      {activeInsp.closure_reason && (
                        <div className="rounded-md bg-slate-100 border border-slate-200 p-2.5 text-xs text-slate-700">
                          <span className="font-semibold text-slate-900">Closure Reason:</span>{' '}
                          <span>{activeInsp.closure_reason}</span>
                          {activeInsp.closure_date && (
                            <span className="text-slate-400 ml-2">({fmtDate(activeInsp.closure_date)})</span>
                          )}
                        </div>
                      )}

                      {/* INSPECTION IMAGES GALLERY (Section 17) */}
                      {activeInsp.inspection_images && activeInsp.inspection_images.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                              <Camera className="h-3.5 w-3.5 text-navy-700" />
                              <span>Photographic Field Evidence</span>
                            </h4>
                            <span className="pill bg-slate-200 text-slate-700 text-[11px] font-semibold">
                              {activeInsp.inspection_images.length} {activeInsp.inspection_images.length === 1 ? 'Photograph' : 'Photographs'}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                            {activeInsp.inspection_images.map((img, idx) => (
                              <button
                                key={img.document_id}
                                type="button"
                                onClick={() => setGalleryItem({
                                  images: activeInsp.inspection_images,
                                  index: idx,
                                  title: `Inspection Evidence · ${fmtDate(activeInsp.inspection_date)}`,
                                })}
                                className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-xs transition hover:border-navy-400 hover:shadow-md"
                              >
                                <div className="relative aspect-4/3 w-full overflow-hidden bg-slate-100">
                                  <AuthImage
                                    documentId={img.document_id}
                                    alt={img.description || img.file_name}
                                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                                  />
                                  <div className="absolute inset-0 bg-navy-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <span className="rounded-full bg-white/90 p-1.5 text-slate-900 shadow">
                                      <Maximize2 className="h-4 w-4" />
                                    </span>
                                  </div>
                                </div>
                                <div className="p-2 text-[11px] text-slate-600">
                                  <div className="truncate font-medium text-slate-800" title={img.description || img.file_name}>
                                    {img.description || img.file_name}
                                  </div>
                                  <div className="text-slate-400 text-[10px] mt-0.5">{fmtDate(img.uploaded_at)}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Public Documents (if any) */}
                      {activeInsp.documents && activeInsp.documents.length > 0 && (
                        <div className="mt-3">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                            Attached Public Inspection Documents
                          </h4>
                          <ul className="space-y-2">
                            {activeInsp.documents.map((d) => (
                              <DocumentRow key={d.document_id} doc={d} />
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* INSPECTION HISTORY (Section 20) */}
                {inspections.length > 1 && (
                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <div className="mb-2.5 flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        Inspection History ({inspections.length} recorded)
                      </h4>
                      <span className="text-xs text-slate-500">Chronological records</span>
                    </div>

                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                      {inspections.map((insp, idx) => {
                        const isSelected = activeInsp?.inspection_id === insp.inspection_id
                        const hasPhotos = (insp.inspection_images || []).length > 0
                        return (
                          <div
                            key={insp.inspection_id}
                            className={`flex flex-wrap items-center justify-between gap-3 p-3 text-xs transition ${
                              isSelected ? 'bg-navy-50/60' : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-[11px] font-bold text-slate-600">
                                {idx + 1}
                              </span>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-slate-900 text-sm">
                                    {fmtDate(insp.inspection_date || insp.scheduled_date)}
                                  </span>
                                  <StatusBadge status={insp.inspection_status} />
                                </div>
                                <div className="text-slate-500 mt-0.5">
                                  Inspector: <span className="font-medium text-slate-700">{insp.inspector_name || 'Assigned Officer'}</span>
                                  {insp.has_report && <span className="text-emerald-700 ml-2">· Report Available</span>}
                                  {hasPhotos && (
                                    <span className="text-navy-700 ml-2">· {insp.inspection_images.length} photo(s)</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => setSelectedInspId(insp.inspection_id)}
                              className={`btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                            >
                              {isSelected ? 'Viewing Report' : 'View Report →'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Financial Transparency */}
          <Card>
            <CardHeader title="Public financial information" subtitle="Amounts published for public transparency" />
            <KeyValue cols={3} items={[
              ['Sanctioned amount', `${inr(p.sanctioned_amount)}`],
              ['Funds released', inr(p.released_amount)],
              ['Expenditure so far', inr(p.expenditure)],
            ]} />
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>Share of sanctioned amount spent</span>
                <b className="text-slate-800">{spent.toFixed(1)}%</b>
              </div>
              <ProgressBar value={spent} tone="bg-amber-500" />
              <p className="hint">Sanctioned {inrFull(p.sanctioned_amount)} · Spent {inrFull(p.expenditure)}</p>
            </div>
          </Card>

          {/* SECTION 17 & 18: AGENCY REQUESTS & DELAY TRANSPARENCY */}
          <Card>
            <CardHeader
              title="Agency Requests & Schedule Transparency"
              subtitle="Formal extension and budget change requests submitted by the implementing agency"
              icon={Clock}
            />

            {/* Schedule & Delay Overview */}
            <div className="mb-4 grid gap-3 sm:grid-cols-3 rounded-lg bg-slate-50 p-3 border border-slate-200 text-xs">
              <div>
                <span className="text-slate-500">Original Deadline</span>
                <div className="font-semibold text-slate-800 mt-0.5">{fmtDate(p.deadline)}</div>
              </div>
              <div>
                <span className="text-slate-500">Current Target Deadline</span>
                <div className="font-semibold text-slate-800 mt-0.5">{fmtDate(p.revised_deadline || p.deadline)}</div>
              </div>
              <div>
                <span className="text-slate-500">Recorded Delay</span>
                <div className="font-semibold mt-0.5">
                  {(p.delay_days || 0) > 0 ? (
                    <span className="text-orange-700">{p.delay_days} days behind</span>
                  ) : (
                    <span className="text-green-700">Within schedule</span>
                  )}
                </div>
              </div>
            </div>

            {(p.requests || []).length === 0 ? (
              <EmptyState title="No agency requests recorded" hint="Any delay, extension, or budget revision requests will be displayed here." />
            ) : (
              <div className="space-y-3">
                {p.requests.map((r) => (
                  <div key={r.request_id} className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-slate-900">{r.request_type || 'Schedule/Budget Request'}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <span className="text-xs text-slate-400">
                        Submitted: {fmtDate(r.submission_date || r.created_at)}
                      </span>
                    </div>

                    <div className="mt-2.5 grid gap-2 text-xs sm:grid-cols-2 text-slate-600">
                      <div>
                        <span className="text-slate-400">Submitted By:</span>{' '}
                        <span className="font-medium text-slate-800">{r.agency_name || agencyName}</span>
                      </div>
                      {r.requested_deadline && (
                        <div>
                          <span className="text-slate-400">Requested Completion:</span>{' '}
                          <span className="font-medium text-slate-800">{fmtDate(r.requested_deadline)}</span>
                        </div>
                      )}
                      {r.requested_amount && (
                        <div>
                          <span className="text-slate-400">Requested Amount:</span>{' '}
                          <span className="font-medium text-slate-800">{inr(r.requested_amount)}</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-2 text-xs text-slate-700">
                      <span className="font-medium text-slate-500">Reason:</span>{' '}
                      <span>{r.reason || r.justification || '—'}</span>
                    </div>

                    {/* Officer Decision Details */}
                    {r.status !== 'Pending' && (
                      <div className="mt-3 rounded-md bg-slate-50 border border-slate-200/80 p-2.5 text-xs">
                        <div className="flex items-center justify-between font-semibold text-slate-800">
                          <span>Officer Decision: {r.status}</span>
                          <span className="text-slate-400 font-normal">{fmtDate(r.decision_date || r.decided_at)}</span>
                        </div>
                        <div className="mt-1 text-slate-600">
                          <span className="font-medium text-slate-500">Reviewed By:</span> {r.reviewed_by || officerName}
                        </div>
                        {(r.decision_reason || r.decision_note) && (
                          <div className="mt-1 text-slate-700">
                            <span className="font-medium text-slate-500">Decision Reason:</span> {r.decision_reason || r.decision_note}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* SECTION 11: OFFICER DECISIONS */}
          {(p.decisions || []).length > 0 && (
            <Card>
              <CardHeader
                title="Official Monitoring Decisions"
                subtitle="Oversight records and action directives issued by Monitoring Officers"
                icon={Gavel}
              />
              <ol className="space-y-3">
                {p.decisions.map((d) => (
                  <li key={d.decision_id} className="relative border-l-2 border-navy-200 pl-4">
                    <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-navy-600" />
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <b className="text-slate-900">{d.decision}</b>
                      <span className="text-slate-500 text-xs">by {d.made_by || officerName} ({d.role || 'Monitoring Officer'})</span>
                      <span className="text-xs text-slate-400">{fmtDateTime(d.created_at)}</span>
                    </div>
                    {d.reason && <p className="mt-1 text-xs text-slate-700">{d.reason}</p>}
                    {d.previous_status && d.new_status && d.previous_status !== d.new_status && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                        <StatusBadge status={d.previous_status} />
                        <ArrowRight className="h-3 w-3 text-slate-400" />
                        <StatusBadge status={d.new_status} />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {/* PART 11: WEEKLY REPORT TRANSPARENCY */}
          <Card>
            <CardHeader
              title="Agency Weekly Reports"
              subtitle="Routine weekly progress, milestones, and physical site updates submitted by the implementing agency"
              icon={CalendarClock}
            />

            {p.weekly_report_status === 'Weekly report overdue' && (
              <Notice tone="orange" className="mb-4 text-xs">
                <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
                <b>Weekly report overdue:</b> The implementing agency has not submitted the latest scheduled progress report. Monitoring authorities have issued a notice.
              </Notice>
            )}

            {(p.progress_reports || p.weekly_reports || []).length === 0 ? (
              <EmptyState
                title="No weekly reports recorded yet"
                hint="Weekly progress reports submitted by the agency will appear here once reporting commences."
              />
            ) : (
              <div className="space-y-3">
                {(p.progress_reports || p.weekly_reports || []).map((wr, idx) => (
                  <div key={wr.report_id || idx} className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-slate-900">
                          {wr.period_label || wr.reporting_week || `Weekly Report #${(p.progress_reports || p.weekly_reports || []).length - idx}`}
                        </span>
                        <span className="pill bg-emerald-100 text-emerald-800 text-[11px] font-semibold">Submitted</span>
                      </div>
                      <span className="text-xs text-slate-500">
                        Date: {fmtDate(wr.report_date || wr.created_at)}
                      </span>
                    </div>

                    <div className="mt-2.5 grid gap-3 sm:grid-cols-3 text-xs">
                      <div>
                        <span className="text-slate-400">Cumulative Progress:</span>{' '}
                        <span className="font-bold text-slate-800">{wr.progress}%</span>
                        {wr.planned_progress !== null && wr.planned_progress !== undefined && (
                          <span className="text-slate-400 ml-1">(Plan: {wr.planned_progress}%)</span>
                        )}
                      </div>
                      <div>
                        <span className="text-slate-400">Reported Expenditure:</span>{' '}
                        <span className="font-medium text-slate-800">{inr(wr.expenditure)}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Reported Schedule:</span>{' '}
                        <span className="font-medium">
                          {(wr.delay_days || 0) > 0 ? (
                            <span className="text-orange-700 font-semibold">{wr.delay_days}d delay</span>
                          ) : (
                            <span className="text-green-700 font-semibold">On schedule</span>
                          )}
                        </span>
                      </div>
                    </div>

                    {(wr.reason_for_delay || wr.delay_explanation) && (
                      <div className="mt-2 rounded-md bg-amber-50/60 border border-amber-200/60 p-2 text-xs text-amber-950">
                        <span className="font-semibold">Reason for delay:</span> {wr.reason_for_delay || wr.delay_explanation}
                      </div>
                    )}

                    {wr.issues && (
                      <div className="mt-1.5 text-xs text-slate-600">
                        <span className="font-medium text-slate-500">Issues noted:</span> {wr.issues}
                      </div>
                    )}

                    {wr.corrective_action && (
                      <div className="mt-1.5 text-xs text-slate-600">
                        <span className="font-medium text-slate-500">Corrective action:</span> {wr.corrective_action}
                      </div>
                    )}

                    {wr.milestones_completed && wr.milestones_completed.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {wr.milestones_completed.map((m, mi) => (
                          <span key={mi} className="pill bg-slate-100 text-slate-700 text-[11px]">
                            ✓ {m}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* PART 13: COMPLAINTS TRANSPARENCY */}
          <Card>
            <CardHeader
              title="Grievance Redressal & Public Complaints"
              subtitle="Public tracking of citizen complaints, verification status, and resolution accountability"
              icon={MessageSquareWarning}
            />

            <div className="grid gap-3 sm:grid-cols-4 rounded-lg bg-slate-50 p-3 border border-slate-200 text-xs text-center">
              <div>
                <span className="text-slate-500 block">Total Grievances</span>
                <span className="font-bold text-slate-900 text-base">{p.complaints_summary?.total || 0}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Resolved</span>
                <span className="font-bold text-emerald-700 text-base">{p.complaints_summary?.resolved || 0}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Under Investigation</span>
                <span className="font-bold text-amber-700 text-base">{p.complaints_summary?.under_investigation || 0}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Open Cases</span>
                <span className="font-bold text-navy-800 text-base">{p.complaints_summary?.open || 0}</span>
              </div>
            </div>

            <div className="mt-4 rounded-md bg-white border border-slate-200 p-3 text-xs text-slate-600 space-y-2">
              <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>Transparent Complaint Lifecycle</span>
              </div>
              <p className="leading-relaxed">
                Citizens can lodge complaints regarding construction quality, delays, or discrepancies. Each complaint follows a defined oversight path:
                <b className="text-slate-800"> Submitted → Screening → Assignment → Investigation & Inspection → Resolution</b>.
              </p>
              <p className="text-[11px] text-slate-500">
                🔒 <i>Citizen identities are strictly masked or anonymous to ensure privacy and protection against reprisal while ensuring public accountability.</i>
              </p>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-slate-500">Observed an issue on this work site?</span>
              <Link to={`/citizen/complaints/new?project=${p.project_id}`} className="btn-secondary btn-sm">
                <MessageSquareWarning className="h-3.5 w-3.5" /> Submit complaint / Report issue
              </Link>
            </div>
          </Card>

          {/* PART 10: WHAT CHANGED? (RECENT PUBLIC CHANGES) */}
          <Card>
            <CardHeader
              title="What Changed? · Recent Public Updates"
              subtitle="Transparent record of progress changes, inspection submissions, risk updates, and official decisions"
              icon={FileText}
            />

            {(p.recent_public_changes || []).length === 0 ? (
              <p className="text-xs text-slate-500 italic">No recent change events recorded yet.</p>
            ) : (
              <div className="space-y-2.5">
                {p.recent_public_changes.map((chg, ci) => (
                  <div key={ci} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 text-xs">
                    <span className="mt-0.5 rounded-full bg-navy-100 p-1 text-navy-700">
                      <FileCheck2 className="h-3.5 w-3.5" />
                    </span>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="font-semibold text-slate-900">{chg.title}</span>
                        <span className="text-[11px] text-slate-400">{chg.date ? fmtDate(chg.date) : 'Recent'}</span>
                      </div>
                      <div className="text-slate-600 mt-0.5">{chg.detail}</div>
                      <span className="inline-block mt-1 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                        {chg.type}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Photos & Public Documents */}
          <Card>
            <CardHeader title="Photos & public documents" />
            {(p.documents || []).length === 0 ? (
              <EmptyState title="No public photos or documents yet" hint="The implementing agency can publish site photos here." />
            ) : (
              <>
                {photos.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {photos.map((d) => (
                      <button key={d.document_id} onClick={() => setZoom(d)} className="group overflow-hidden rounded-md border border-slate-200 text-left hover:border-navy-400">
                        <AuthImage documentId={d.document_id} alt={d.description || d.file_name} className="h-32 w-full object-cover" />
                        <div className="px-2 py-1.5 text-xs text-slate-600">
                          <div className="truncate">{d.description || d.file_name}</div>
                          <div className="text-slate-400">{fmtDate(d.uploaded_at)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {others.length > 0 && <ul className="mt-3 space-y-2">{others.map((d) => <DocumentRow key={d.document_id} doc={d} />)}</ul>}
              </>
            )}
          </Card>

          {/* Citizen reviews */}
          <Card>
            <CardHeader title="Citizen reviews" subtitle="Reviews are shown with masked names" />
            <ErrorBanner error={reviews.error} onRetry={reviews.reload} />
            {reviews.loading && !reviews.data ? (
              <Spinner />
            ) : (reviews.data || []).length === 0 ? (
              <p className="text-sm text-slate-500">No reviews yet - be the first.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {reviews.data.map((r) => (
                  <li key={r.review_id} className="py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-800">{r.author}</span>
                      <span className="text-xs text-slate-400">{timeAgo(r.created_at)}</span>
                    </div>
                    <Stars value={r.rating} />
                    {r.comment && <p className="mt-1 text-sm text-slate-600">{r.comment}</p>}
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={(e) => { e.preventDefault(); if (rating) submit() }} className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="mb-2">Write a review</h3>
              <ErrorBanner error={error} className="mb-3" />
              <Field label="Your rating" required><StarInput value={rating} onChange={(v) => { setRating(v); setError(null) }} /></Field>
              <Field label="Comment (optional)" className="mt-3"><Textarea value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} placeholder="What have you observed at the site?" /></Field>
              <button className="btn-primary mt-3" disabled={busy || !rating}>{busy ? 'Submitting…' : 'Submit review'}</button>
              <p className="hint">You can review each project once.</p>
            </form>
          </Card>
        </div>

        {/* Right 1 Column */}
        <div className="space-y-5">
          {/* SECTION 19: COMPACT PUBLIC PROJECT TRANSPARENCY CARD */}
          <div className="rounded-xl border border-navy-300 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-navy-800 border-b border-navy-100 pb-2.5">
              <ShieldCheck className="h-4 w-4 text-navy-700" />
              <span>Public Project Transparency</span>
            </div>

            <div className="mt-4 space-y-3.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium">Risk Score</span>
                <span className="font-bold text-slate-900 text-base">
                  {hasRisk ? `${Number(p.risk_score).toFixed(0)} / 100` : 'Risk Analysis: Pending'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium">Risk Level</span>
                {hasRisk && p.risk_level ? (
                  <RiskBadge level={p.risk_level} />
                ) : (
                  <span className="pill bg-slate-100 text-slate-500 text-xs">Risk Analysis: Pending</span>
                )}
              </div>

              <div className="border-t border-slate-100 pt-3">
                <div className="text-xs text-slate-400 font-medium">Implementing Agency</div>
                <div className="mt-0.5 font-semibold text-slate-800">{agencyName}</div>
              </div>

              <div className="border-t border-slate-100 pt-3">
                <div className="text-xs text-slate-400 font-medium">Monitoring Officer</div>
                <div className="mt-0.5 font-semibold text-slate-800">{officerName}</div>
                <div className="text-xs text-slate-400">Role: Designated Monitoring Officer</div>
              </div>

              <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-xs text-slate-500">
                <span>Last Risk Update</span>
                <span className="font-medium text-slate-700">{p.risk_updated_at ? fmtDate(p.risk_updated_at) : 'Not available'}</span>
              </div>

              {/* SECTION 19: LATEST INSPECTION IN TRANSPARENCY CARD */}
              <div className="border-t border-slate-100 pt-3">
                <div className="text-xs text-slate-400 font-medium">
                  {latestReport ? 'Latest Inspection' : nextScheduled ? 'Next Scheduled Inspection' : 'Inspection Status'}
                </div>
                {latestReport ? (
                  <div className="mt-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 text-xs">
                        {fmtDate(latestReport.inspection_date || latestReport.completed_date || latestReport.scheduled_date)}
                      </span>
                      <StatusBadge status={latestReport.inspection_status || latestReport.status} />
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      Inspector: <span className="font-medium text-slate-700">{latestReport.inspector_name || 'Assigned Officer'}</span>
                    </div>
                  </div>
                ) : nextScheduled ? (
                  <div className="mt-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 text-xs">{fmtDate(nextScheduled.scheduled_date || nextScheduled.inspection_date)}</span>
                      <span className="pill bg-indigo-100 text-indigo-800 text-[11px] font-semibold">Scheduled</span>
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      Inspector: <span className="font-medium text-slate-700">{nextScheduled.inspector_name || 'Assigned Officer'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-slate-500 italic">Inspection report not yet submitted.</div>
                )}
              </div>

              {/* SECTION 15: INFORMATION TIMELINESS (LAST UPDATED) */}
              <div className="border-t border-slate-100 pt-3 space-y-1.5 text-xs text-slate-500">
                <div className="font-semibold uppercase tracking-wider text-[10px] text-slate-400 mb-1">
                  Information Timeliness
                </div>
                <div className="flex justify-between">
                  <span>Project Record:</span>
                  <span className="font-medium text-slate-700">{p.last_updated?.project ? fmtDate(p.last_updated.project) : '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Financial Data:</span>
                  <span className="font-medium text-slate-700">{p.last_updated?.financial ? fmtDate(p.last_updated.financial) : '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Risk Assessment:</span>
                  <span className="font-medium text-slate-700">{p.last_updated?.risk_analysis ? fmtDate(p.last_updated.risk_analysis) : 'Pending'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Site Inspection:</span>
                  <span className="font-medium text-slate-700">{p.last_updated?.inspection ? fmtDate(p.last_updated.inspection) : 'Not conducted yet'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Weekly Report:</span>
                  <span className="font-medium text-slate-700">{p.last_updated?.weekly_report ? fmtDate(p.last_updated.weekly_report) : '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline Card */}
          <Card>
            <CardHeader title="Timeline" icon={CalendarDays} />
            {(p.timeline || []).length === 0 ? (
              <p className="text-sm text-slate-500">No dates published.</p>
            ) : (
              <ol className="relative ml-2 border-l-2 border-slate-200">
                {p.timeline.map((t) => (
                  <li key={t.label} className="mb-4 ml-4 last:mb-0">
                    <span className={`absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-white ${t.label === 'Completed' ? 'bg-green-500' : t.label.startsWith('Revised') ? 'bg-orange-500' : 'bg-navy-600'}`} />
                    <div className="text-sm font-medium text-slate-800">{t.label}</div>
                    <div className="text-xs text-slate-500">{fmtDate(t.date)}</div>
                  </li>
                ))}
              </ol>
            )}
            {p.public_status === 'Delayed' && (
              <Notice tone="orange" className="mt-4">
                <AlertTriangle className="inline h-3.5 w-3.5" /> This project is running behind its original schedule.
              </Notice>
            )}
          </Card>

          {/* Location Map */}
          {p.latitude && p.longitude && (
            <Card>
              <CardHeader title="Location" icon={MapPin} />
              <MapView projects={[p]} colorBy="status" height={240} />
            </Card>
          )}

          {/* See a problem? Complaint CTA */}
          <Card className="bg-navy-50 border-navy-100">
            <h3>See a problem?</h3>
            <p className="mt-1 text-sm text-slate-600">Poor quality, stalled work or a safety hazard? Tell us. You can attach photos and choose to stay anonymous.</p>
            <Link to={`/citizen/complaints/new?project=${p.project_id}`} className="btn-warn mt-3 w-full">Submit a complaint</Link>
          </Card>
        </div>
      </div>

      <Modal open={!!zoom} onClose={() => setZoom(null)} title={zoom?.description || zoom?.file_name || 'Photo'} size="lg">
        {zoom && <AuthImage documentId={zoom.document_id} alt={zoom.file_name} className="mx-auto max-h-[70vh] rounded" />}
      </Modal>

      {/* Lightbox / Gallery Modal for Inspection Images with Navigation (Section 17) */}
      <Modal
        open={!!galleryItem}
        onClose={() => setGalleryItem(null)}
        title={galleryItem ? `${galleryItem.title || 'Inspection Photo'} (${galleryItem.index + 1} of ${galleryItem.images.length})` : 'Inspection Photo'}
        size="lg"
      >
        {galleryItem && galleryItem.images[galleryItem.index] && (
          <div className="space-y-4">
            <div className="relative flex items-center justify-center bg-slate-950/5 rounded-lg overflow-hidden min-h-[300px]">
              <AuthImage
                documentId={galleryItem.images[galleryItem.index].document_id}
                alt={galleryItem.images[galleryItem.index].description || galleryItem.images[galleryItem.index].file_name}
                className="max-h-[65vh] w-auto mx-auto object-contain rounded"
              />

              {galleryItem.images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setGalleryItem((g) => ({ ...g, index: (g.index - 1 + g.images.length) % g.images.length }))}
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition"
                    title="Previous image"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setGalleryItem((g) => ({ ...g, index: (g.index + 1) % g.images.length }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition"
                    title="Next image"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
              <div className="font-medium text-slate-800">
                {galleryItem.images[galleryItem.index].description || galleryItem.images[galleryItem.index].file_name}
              </div>
              <div className="text-slate-400">
                {fmtDateTime(galleryItem.images[galleryItem.index].uploaded_at)}
              </div>
            </div>

            {/* Thumbnail Strip */}
            {galleryItem.images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pt-1 pb-2">
                {galleryItem.images.map((img, i) => (
                  <button
                    key={img.document_id}
                    onClick={() => setGalleryItem((g) => ({ ...g, index: i }))}
                    className={`h-14 w-14 shrink-0 rounded border-2 overflow-hidden transition ${
                      i === galleryItem.index ? 'border-navy-600 ring-2 ring-navy-200' : 'border-slate-200 opacity-60 hover:opacity-100'
                    }`}
                  >
                    <AuthImage documentId={img.document_id} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
