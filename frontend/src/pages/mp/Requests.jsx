import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Calendar, CheckCircle2, Clock, DollarSign, Eye, FileText, Inbox, RefreshCw,
  Search, ShieldAlert, XCircle,
} from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDate, fmtDateTime, inr } from '../../lib/format'
import {
  Card, CardHeader, DataTable, EmptyState, ErrorBanner, Modal, PageHeader, Select,
  Spinner, StatusBadge, useApi,
} from '../../components/ui'

export default function MpRequests() {
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedReq, setSelectedReq] = useState(null)

  const { data, loading, error, reload } = useApi(
    () => api.get('/api/requests', { status: statusFilter || undefined }),
    [statusFilter]
  )

  const requests = data || []
  const pendingCount = requests.filter((r) => r.status === 'Pending').length
  const approvedCount = requests.filter((r) => r.status === 'Approved').length
  const rejectedCount = requests.filter((r) => r.status === 'Rejected').length

  return (
    <>
      <PageHeader
        back={{ to: '/mp', label: 'Dashboard' }}
        title="Agency Requests Oversight"
        subtitle="Monitor deadline extension and budget modification requests submitted by implementing agencies and track administrative decisions"
        actions={
          <button onClick={reload} className="btn-secondary">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      <ErrorBanner error={error} onRetry={reload} className="mb-4" />

      {/* Metrics Row */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="border-l-4 border-l-amber-500">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{pendingCount}</div>
              <div className="text-xs font-medium text-slate-500">Pending Review</div>
            </div>
          </div>
        </Card>

        <Card className="border-l-4 border-l-emerald-500">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{approvedCount}</div>
              <div className="text-xs font-medium text-slate-500">Approved Requests</div>
            </div>
          </div>
        </Card>

        <Card className="border-l-4 border-l-red-500">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-700">
              <XCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{rejectedCount}</div>
              <div className="text-xs font-medium text-slate-500">Rejected Requests</div>
            </div>
          </div>
        </Card>

        <Card className="border-l-4 border-l-navy-600">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
              <Inbox className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{requests.length}</div>
              <div className="text-xs font-medium text-slate-500">Total Recorded</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Requests Table */}
      <Card pad={false}>
        <div className="p-4 border-b border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardHeader
              title="Constituency Agency Requests"
              subtitle="Formal requests for project timeline extensions and budget variations"
              icon={Inbox}
            />
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
              <option value="">All statuses</option>
              <option value="Pending">Pending only</option>
              <option value="Approved">Approved only</option>
              <option value="Rejected">Rejected only</option>
            </Select>
          </div>
        </div>

        <DataTable
          rows={requests}
          rowKey={(r) => r.request_id}
          empty={<EmptyState title="No requests found" hint="No agency requests match the selected status filter." />}
          columns={[
            {
              key: 'type',
              header: 'Request Type',
              render: (r) => (
                r.request_type === 'Extension' ? (
                  <span className="pill bg-blue-100 text-blue-800 font-semibold flex items-center gap-1 w-fit">
                    <Calendar className="h-3 w-3" /> Extension
                  </span>
                ) : (
                  <span className="pill bg-purple-100 text-purple-800 font-semibold flex items-center gap-1 w-fit">
                    <DollarSign className="h-3 w-3" /> Budget Change
                  </span>
                )
              ),
            },
            {
              key: 'project',
              header: 'Project Details',
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
              key: 'request_details',
              header: 'Requested Modification',
              render: (r) => (
                r.request_type === 'Extension' ? (
                  <div>
                    <span className="text-xs text-slate-500">Requested Deadline:</span>
                    <div className="text-sm font-semibold text-slate-900">{fmtDate(r.requested_deadline)}</div>
                  </div>
                ) : (
                  <div>
                    <span className="text-xs text-slate-500">Requested Budget:</span>
                    <div className="text-sm font-semibold text-slate-900">{inr(r.requested_amount)}</div>
                  </div>
                )
              ),
            },
            {
              key: 'justification',
              header: 'Justification',
              render: (r) => <p className="text-xs text-slate-600 max-w-sm line-clamp-2">{r.justification}</p>,
            },
            {
              key: 'status',
              header: 'Decision Status',
              render: (r) => (
                r.status === 'Approved' ? (
                  <span className="pill bg-emerald-100 text-emerald-800 font-semibold">Approved</span>
                ) : r.status === 'Rejected' ? (
                  <span className="pill bg-red-100 text-red-800 font-semibold">Rejected</span>
                ) : (
                  <span className="pill bg-amber-100 text-amber-800 font-semibold">Pending Review</span>
                )
              ),
            },
            {
              key: 'submitted',
              header: 'Submitted',
              render: (r) => <span className="text-xs text-slate-500">{fmtDate(r.created_at)}</span>,
            },
            {
              key: 'actions',
              header: '',
              render: (r) => (
                <button onClick={() => setSelectedReq(r)} className="btn-secondary btn-sm text-navy-700">
                  <Eye className="h-3.5 w-3.5 mr-1" /> View
                </button>
              ),
            },
          ]}
        />
      </Card>

      {/* Detail Modal */}
      {selectedReq && (
        <Modal
          open={!!selectedReq}
          onClose={() => setSelectedReq(null)}
          title={`Request #${selectedReq.request_id} · ${selectedReq.request_type}`}
        >
          <div className="space-y-4">
            <div className="rounded-lg bg-navy-50 p-3.5 border border-navy-100">
              <div className="font-semibold text-navy-900">{selectedReq.project_name}</div>
              <div className="text-xs text-navy-700 font-mono mt-0.5">{selectedReq.project_code}</div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded border border-slate-200 p-2.5 bg-slate-50">
                <div className="text-[11px] text-slate-500">Request Type</div>
                <div className="text-sm font-semibold text-slate-800">{selectedReq.request_type}</div>
              </div>
              <div className="rounded border border-slate-200 p-2.5 bg-slate-50">
                <div className="text-[11px] text-slate-500">Status</div>
                <div className="text-sm font-semibold text-slate-800">{selectedReq.status}</div>
              </div>
              <div className="rounded border border-slate-200 p-2.5 bg-slate-50">
                <div className="text-[11px] text-slate-500">Submission Date</div>
                <div className="text-sm font-semibold text-slate-800">{fmtDate(selectedReq.created_at)}</div>
              </div>
            </div>

            {selectedReq.request_type === 'Extension' ? (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                <div className="text-xs font-semibold text-blue-900">Requested Extension Deadline</div>
                <div className="text-base font-bold text-blue-900 mt-0.5">{fmtDate(selectedReq.requested_deadline)}</div>
              </div>
            ) : (
              <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-3">
                <div className="text-xs font-semibold text-purple-900">Requested Revised Budget</div>
                <div className="text-base font-bold text-purple-900 mt-0.5">{inr(selectedReq.requested_amount)}</div>
              </div>
            )}

            <div>
              <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Agency Rationale / Justification</div>
              <p className="mt-1 text-sm text-slate-800 bg-slate-50 rounded p-3 border border-slate-200">{selectedReq.justification}</p>
            </div>

            {selectedReq.decision_note && (
              <div className="rounded-lg border border-slate-300 bg-slate-100 p-3">
                <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  Administrative Decision Note ({fmtDate(selectedReq.decided_at)})
                </div>
                <p className="mt-1 text-sm text-slate-800">{selectedReq.decision_note}</p>
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-slate-200">
              <Link to={`/mp/projects/${selectedReq.project_id}`} className="text-xs font-semibold text-navy-700 hover:underline">
                View Project Details →
              </Link>
              <button onClick={() => setSelectedReq(null)} className="btn-secondary btn-sm">
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
