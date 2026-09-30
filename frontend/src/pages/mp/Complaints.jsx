import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, Clock, Eye, FileText, Image as ImageIcon,
  MessageSquareWarning, RefreshCw, Search, ShieldAlert,
} from 'lucide-react'
import { api, openProtectedFile } from '../../lib/api'
import { fmtDate, fmtDateTime } from '../../lib/format'
import {
  AuthImage, Card, CardHeader, DataTable, EmptyState, ErrorBanner, Modal, PageHeader,
  SearchBox, Select, Spinner, StatusBadge, useApi,
} from '../../components/ui'

export default function MpComplaints() {
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [q, setQ] = useState('')
  const [selectedComplaint, setSelectedComplaint] = useState(null)

  const meta = useApi(() => api.get('/api/meta'), [])
  const { data, loading, error, reload } = useApi(
    () => api.get('/api/complaints', {
      status: statusFilter || undefined,
      q: q || undefined,
    }),
    [statusFilter, q]
  )

  const complaints = (data?.items || []).filter((c) => {
    return !categoryFilter || c.category === categoryFilter
  })

  const seriousCount = complaints.filter((c) => c.serious).length
  const underInvestigation = complaints.filter((c) => ['Assigned', 'Under Investigation'].includes(c.status)).length
  const resolvedCount = complaints.filter((c) => ['Resolved', 'Closed'].includes(c.status)).length

  return (
    <>
      <PageHeader
        back={{ to: '/mp', label: 'Dashboard' }}
        title="Constituency Citizen Grievance Tracker"
        subtitle="Oversight of public complaints, field quality grievances, financial irregularity reports, and resolution integrity"
        actions={
          <button onClick={reload} className="btn-secondary">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      <ErrorBanner error={error} onRetry={reload} className="mb-4" />

      {/* Metric Cards */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="border-l-4 border-l-navy-600">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
              <MessageSquareWarning className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{complaints.length}</div>
              <div className="text-xs font-medium text-slate-500">Total Grievances</div>
            </div>
          </div>
        </Card>

        <Card className="border-l-4 border-l-orange-500">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-700">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{underInvestigation}</div>
              <div className="text-xs font-medium text-slate-500">Under Active Investigation</div>
            </div>
          </div>
        </Card>

        <Card className="border-l-4 border-l-red-500">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-700">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{seriousCount}</div>
              <div className="text-xs font-medium text-slate-500">Serious / Critical Flags</div>
            </div>
          </div>
        </Card>

        <Card className="border-l-4 border-l-emerald-500">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{resolvedCount}</div>
              <div className="text-xs font-medium text-slate-500">Resolved / Closed</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters & Table */}
      <Card pad={false}>
        <div className="p-4 border-b border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardHeader
              title="Citizen Complaints"
              subtitle="Track public reporting on quality, delays, safety, and financial integrity"
              icon={MessageSquareWarning}
            />
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox value={q} onChange={setQ} placeholder="Search tracking ID, text…" className="w-56" />
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36">
                <option value="">All statuses</option>
                <option value="Submitted">Submitted</option>
                <option value="Assigned">Assigned</option>
                <option value="Under Investigation">Under Investigation</option>
                <option value="Resolved">Resolved</option>
                <option value="Closed">Closed</option>
              </Select>
              <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-48">
                <option value="">All categories</option>
                {(meta.data?.complaint_categories || [
                  'Poor quality of work', 'Work delay / stalled', 'Financial irregularity', 'Safety hazard', 'Other',
                ]).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        <DataTable
          rows={complaints}
          rowKey={(r) => r.complaint_id}
          empty={<EmptyState title="No complaints found" hint="No citizen complaints match the selected filter criteria." />}
          columns={[
            {
              key: 'tracking',
              header: 'Tracking ID',
              render: (r) => (
                <div>
                  <span className="font-mono text-xs font-bold text-navy-800">{r.tracking_id}</span>
                  {r.serious && (
                    <span className="ml-1.5 pill bg-red-100 text-red-800 font-semibold text-[10px]">
                      Serious
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: 'project',
              header: 'Target Project',
              render: (r) => (
                <div className="max-w-xs">
                  <Link to={`/mp/projects/${r.project_id}`} className="font-semibold text-navy-700 hover:underline">
                    {r.project_name || `Project #${r.project_id}`}
                  </Link>
                  <div className="text-xs font-mono text-slate-500">{r.project_code}</div>
                </div>
              ),
            },
            {
              key: 'category',
              header: 'Grievance Domain',
              render: (r) => <span className="font-medium text-xs text-slate-800">{r.category}</span>,
            },
            {
              key: 'description',
              header: 'Description',
              render: (r) => <p className="text-xs text-slate-600 max-w-sm line-clamp-2">{r.description}</p>,
            },
            {
              key: 'screening',
              header: 'Screening',
              render: (r) => (
                r.screening_status === 'Verified' ? (
                  <span className="pill bg-emerald-100 text-emerald-800 text-xs">Verified</span>
                ) : r.screening_status === 'Dismissed' ? (
                  <span className="pill bg-slate-100 text-slate-600 text-xs">Dismissed</span>
                ) : (
                  <span className="pill bg-amber-100 text-amber-800 text-xs">Pending</span>
                )
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (r) => <StatusBadge status={r.status} />,
            },
            {
              key: 'date',
              header: 'Lodged',
              render: (r) => <span className="text-xs text-slate-500">{fmtDate(r.created_at)}</span>,
            },
            {
              key: 'actions',
              header: '',
              render: (r) => (
                <button onClick={() => setSelectedComplaint(r)} className="btn-secondary btn-sm text-navy-700">
                  <Eye className="h-3.5 w-3.5 mr-1" /> View
                </button>
              ),
            },
          ]}
        />
      </Card>

      {/* Details Modal */}
      {selectedComplaint && (
        <Modal
          open={!!selectedComplaint}
          onClose={() => setSelectedComplaint(null)}
          title={`Grievance Record · ${selectedComplaint.tracking_id}`}
        >
          <div className="space-y-4">
            <div className="rounded-lg bg-navy-50 p-4 border border-navy-100">
              <div className="text-xs uppercase tracking-wider text-navy-600 font-semibold">Subject Project</div>
              <div className="text-base font-bold text-navy-900">{selectedComplaint.project_name}</div>
              <div className="text-xs text-navy-700 font-mono mt-0.5">{selectedComplaint.project_code}</div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded border border-slate-200 p-2.5 bg-slate-50">
                <div className="text-[11px] text-slate-500">Category</div>
                <div className="text-xs font-bold text-slate-800 mt-0.5">{selectedComplaint.category}</div>
              </div>
              <div className="rounded border border-slate-200 p-2.5 bg-slate-50">
                <div className="text-[11px] text-slate-500">Screening Status</div>
                <div className="text-xs font-bold text-slate-800 mt-0.5">{selectedComplaint.screening_status}</div>
              </div>
              <div className="rounded border border-slate-200 p-2.5 bg-slate-50">
                <div className="text-[11px] text-slate-500">Workflow Status</div>
                <div className="text-xs font-bold text-slate-800 mt-0.5">{selectedComplaint.status}</div>
              </div>
              <div className="rounded border border-slate-200 p-2.5 bg-slate-50">
                <div className="text-[11px] text-slate-500">Submission Date</div>
                <div className="text-xs font-bold text-slate-800 mt-0.5">{fmtDate(selectedComplaint.created_at)}</div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Citizen Statement</div>
              <p className="mt-1 text-sm text-slate-800 bg-slate-50 rounded p-3 border border-slate-200 whitespace-pre-line">
                {selectedComplaint.description}
              </p>
            </div>

            {selectedComplaint.agency_response && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                <div className="text-xs font-semibold text-blue-900 uppercase tracking-wide">Implementing Agency Explanation</div>
                <p className="mt-1 text-xs text-blue-950">{selectedComplaint.agency_response}</p>
              </div>
            )}

            {selectedComplaint.resolution_notes && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                <div className="text-xs font-semibold text-emerald-900 uppercase tracking-wide">Official Resolution Summary</div>
                <p className="mt-1 text-xs text-emerald-950">{selectedComplaint.resolution_notes}</p>
              </div>
            )}

            {selectedComplaint.evidence?.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">Attached Citizen Evidence</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {selectedComplaint.evidence.map((doc) => (
                    <div key={doc.document_id} className="rounded border border-slate-200 p-2 bg-slate-50 text-xs">
                      <div className="font-semibold truncate">{doc.file_name}</div>
                      <div className="text-slate-400 mt-1">{doc.content_type}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-slate-200">
              <Link to={`/mp/projects/${selectedComplaint.project_id}`} className="text-xs font-semibold text-navy-700 hover:underline">
                Open Project Case File →
              </Link>
              <button onClick={() => setSelectedComplaint(null)} className="btn-secondary btn-sm">
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
