import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowRight, Building2, Calendar, CheckCircle2, ChevronRight,
  ClipboardList, Eye, FileText, Image as ImageIcon, RefreshCw, Search,
} from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDate, fmtDateTime, inr, pct } from '../../lib/format'
import {
  AuthImage, Card, CardHeader, DataTable, EmptyState, ErrorBanner, Modal, Notice,
  PageHeader, ProgressBar, SearchBox, Select, Spinner, useApi,
} from '../../components/ui'

export default function MpReports() {
  const [projectFilter, setProjectFilter] = useState('')
  const [agencyFilter, setAgencyFilter] = useState('')
  const [selectedReport, setSelectedReport] = useState(null)

  const meta = useApi(() => api.get('/api/meta'), [])
  const projects = useApi(() => api.get('/api/projects', { page_size: 100 }), [])
  const { data, loading, error, reload } = useApi(
    () => api.get('/api/progress-reports', {
      project_id: projectFilter || undefined,
      agency_id: agencyFilter || undefined,
      page_size: 50,
    }),
    [projectFilter, agencyFilter]
  )

  const reports = data?.items || []

  return (
    <>
      <PageHeader
        back={{ to: '/mp', label: 'Dashboard' }}
        title="Agency Progress Reports"
        subtitle="Review weekly execution milestones, expenditure progress, delay justifications, and field photos submitted by implementing agencies"
        actions={
          <button onClick={reload} className="btn-secondary">
            <RefreshCw className="h-4 w-4" /> Refresh Reports
          </button>
        }
      />

      <ErrorBanner error={error} onRetry={reload} className="mb-4" />

      {/* Filter Bar */}
      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">Filter by Project</label>
            <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="">All constituency projects</option>
              {(projects.data?.items || []).map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {p.project_code} · {p.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="label">Filter by Implementing Agency</label>
            <Select value={agencyFilter} onChange={(e) => setAgencyFilter(e.target.value)}>
              <option value="">All executing agencies</option>
              {(meta.data?.agencies || []).map((a) => (
                <option key={a.agency_id} value={a.agency_id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-end">
            <button
              onClick={() => { setProjectFilter(''); setAgencyFilter('') }}
              className="btn-secondary w-full"
              disabled={!projectFilter && !agencyFilter}
            >
              Reset Filters
            </button>
          </div>
        </div>
      </Card>

      {/* Reports Table */}
      <Card pad={false}>
        <div className="p-4 border-b border-slate-200">
          <CardHeader
            title="Consolidated Progress Feed"
            subtitle={`${reports.length} report(s) submitted under current criteria`}
            icon={ClipboardList}
          />
        </div>
        <DataTable
          rows={reports}
          rowKey={(r) => r.report_id}
          empty={<EmptyState title="No progress reports" hint="No agency submissions match the current criteria." />}
          columns={[
            {
              key: 'date',
              header: 'Report Date / Week',
              render: (r) => (
                <div>
                  <div className="font-semibold text-slate-800 text-sm">{fmtDate(r.report_date)}</div>
                  <div className="text-xs text-slate-500">{r.reporting_week || r.period_label || 'Weekly update'}</div>
                </div>
              ),
            },
            {
              key: 'project',
              header: 'Project',
              render: (r) => (
                <div className="max-w-xs">
                  <Link to={`/mp/projects/${r.project_id}`} className="font-semibold text-navy-700 hover:underline">
                    {r.project_name || `Project #${r.project_id}`}
                  </Link>
                  <div className="text-xs text-slate-500 font-mono">{r.project_code}</div>
                </div>
              ),
            },
            {
              key: 'agency',
              header: 'Agency',
              render: (r) => (
                <div className="text-xs text-slate-700">
                  <Building2 className="inline h-3.5 w-3.5 mr-1 text-slate-400" />
                  {r.agency_name || 'Implementing Agency'}
                </div>
              ),
            },
            {
              key: 'progress',
              header: 'Physical Progress',
              render: (r) => (
                <div className="w-28">
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="font-bold text-slate-900">{pct(r.progress)}</span>
                    {r.progress_change > 0 && (
                      <span className="text-emerald-600 font-semibold text-[11px]">+{r.progress_change}%</span>
                    )}
                  </div>
                  <ProgressBar value={r.progress} planned={r.planned_progress} />
                </div>
              ),
            },
            {
              key: 'expenditure',
              header: 'Expenditure',
              render: (r) => (
                <div>
                  <div className="font-semibold text-slate-900 text-sm">{inr(r.expenditure)}</div>
                  <div className="text-[11px] text-slate-500">Cumulative</div>
                </div>
              ),
            },
            {
              key: 'delay',
              header: 'Delay Status',
              render: (r) => (
                r.delay_days > 0 ? (
                  <span className="pill bg-orange-100 text-orange-800 text-xs">+{r.delay_days}d delay</span>
                ) : (
                  <span className="pill bg-emerald-100 text-emerald-800 text-xs">On time</span>
                )
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (r) => (
                <button
                  onClick={() => setSelectedReport(r)}
                  className="btn-secondary btn-sm flex items-center gap-1 text-navy-700"
                >
                  <Eye className="h-3.5 w-3.5" /> Details
                </button>
              ),
            },
          ]}
        />
      </Card>

      {/* Report Details Modal */}
      {selectedReport && (
        <Modal
          open={!!selectedReport}
          onClose={() => setSelectedReport(null)}
          title={`Agency Progress Report · ${selectedReport.reporting_week || selectedReport.period_label}`}
        >
          <div className="space-y-4">
            <div className="rounded-lg bg-navy-50 p-4 border border-navy-100">
              <div className="text-xs uppercase tracking-wider text-navy-600 font-semibold">Project</div>
              <div className="text-base font-bold text-navy-900">{selectedReport.project_name}</div>
              <div className="text-xs text-navy-700 font-mono mt-0.5">{selectedReport.project_code} · {selectedReport.agency_name}</div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded border border-slate-200 p-2.5 bg-slate-50">
                <div className="text-[11px] text-slate-500">Report Date</div>
                <div className="text-sm font-bold text-slate-900">{fmtDate(selectedReport.report_date)}</div>
              </div>
              <div className="rounded border border-slate-200 p-2.5 bg-slate-50">
                <div className="text-[11px] text-slate-500">Physical Progress</div>
                <div className="text-sm font-bold text-slate-900">{pct(selectedReport.progress)}</div>
              </div>
              <div className="rounded border border-slate-200 p-2.5 bg-slate-50">
                <div className="text-[11px] text-slate-500">Reported Spend</div>
                <div className="text-sm font-bold text-slate-900">{inr(selectedReport.expenditure)}</div>
              </div>
              <div className="rounded border border-slate-200 p-2.5 bg-slate-50">
                <div className="text-[11px] text-slate-500">Delay Status</div>
                <div className="text-sm font-bold text-slate-900">
                  {selectedReport.delay_days > 0 ? `+${selectedReport.delay_days} days` : 'Nil'}
                </div>
              </div>
            </div>

            {selectedReport.reason_for_delay && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                <div className="text-xs font-semibold text-orange-800 uppercase tracking-wide">Reported Delay Explanation</div>
                <p className="mt-1 text-xs text-orange-900">{selectedReport.reason_for_delay}</p>
              </div>
            )}

            {selectedReport.issues && (
              <div>
                <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Key Challenges & Issues</div>
                <p className="mt-1 text-sm text-slate-700 bg-slate-50 rounded p-2.5 border border-slate-200">{selectedReport.issues}</p>
              </div>
            )}

            {selectedReport.corrective_action && (
              <div>
                <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Corrective Action Taken</div>
                <p className="mt-1 text-sm text-slate-700 bg-slate-50 rounded p-2.5 border border-slate-200">{selectedReport.corrective_action}</p>
              </div>
            )}

            {selectedReport.next_week_plan && (
              <div>
                <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Upcoming Work Plan</div>
                <p className="mt-1 text-sm text-slate-700 bg-slate-50 rounded p-2.5 border border-slate-200">{selectedReport.next_week_plan}</p>
              </div>
            )}

            {selectedReport.milestones_completed?.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Milestones Achieved</div>
                <ul className="mt-1 space-y-1">
                  {selectedReport.milestones_completed.map((m, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-xs text-slate-700">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>{typeof m === 'string' ? m : m.title || m.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-slate-200">
              <Link to={`/mp/projects/${selectedReport.project_id}`} className="text-xs font-semibold text-navy-700 hover:underline">
                Open full project case file →
              </Link>
              <button onClick={() => setSelectedReport(null)} className="btn-secondary btn-sm">
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
