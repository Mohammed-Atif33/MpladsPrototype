import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Building2, CheckCircle2, History, ListChecks, RefreshCw, Search,
  ShieldCheck, UserCheck, Users,
} from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDateTime, inr, pct } from '../../lib/format'
import {
  Card, CardHeader, DataTable, EmptyState, ErrorBanner, Field, Modal, Notice, PageHeader,
  ProgressBar, SearchBox, Select, Spinner, StatusBadge, Textarea, useAction, useApi, useToast,
} from '../../components/ui'

export default function MpAssignments() {
  const toast = useToast()
  const { data, loading, error, reload } = useApi(() => api.get('/api/projects/assignments-overview'), [])
  const meta = useApi(() => api.get('/api/meta'), [])

  const [q, setQ] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [reassignModalOpen, setReassignModalOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState(null)
  const [newAgencyId, setNewAgencyId] = useState('')
  const [newOfficerId, setNewOfficerId] = useState('')
  const [reassignReason, setReassignReason] = useState('')
  const [formError, setFormError] = useState('')

  const projects = (data?.projects || []).filter((p) => {
    const matchesQ = !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.project_code.toLowerCase().includes(q.toLowerCase())
    const matchesDist = !districtFilter || p.district === districtFilter
    return matchesQ && matchesDist
  })

  const history = data?.recent_history || []
  const agencies = meta.data?.agencies || []
  const officers = meta.data?.officers || []

  const openReassign = (p) => {
    setSelectedProject(p)
    setNewAgencyId(p.agency_id ? String(p.agency_id) : '')
    setNewOfficerId(p.officer_id ? String(p.officer_id) : '')
    setReassignReason('')
    setFormError('')
    setReassignModalOpen(true)
  }

  const [executeReassign, { busy: reassigning }] = useAction(async () => {
    if (!selectedProject) return
    if (!reassignReason.trim()) {
      setFormError('Please enter an official justification/reason for this reassignment.')
      return
    }
    const agencyIdNum = newAgencyId ? parseInt(newAgencyId, 10) : null
    const officerIdNum = newOfficerId ? parseInt(newOfficerId, 10) : null

    if (agencyIdNum === selectedProject.agency_id && officerIdNum === selectedProject.officer_id) {
      setFormError('Please select a different agency or officer to reassign.')
      return
    }

    await api.post(`/api/projects/${selectedProject.project_id}/reassign`, {
      agency_id: agencyIdNum,
      officer_id: officerIdNum,
      reason: reassignReason.trim(),
    })

    toast(`Successfully updated assignments for ${selectedProject.project_code}.`)
    setReassignModalOpen(false)
    reload()
  })

  if (loading && !data) return <Spinner className="min-h-[50vh]" label="Loading assignments and audit logs…" />

  return (
    <>
      <PageHeader
        back={{ to: '/mp', label: 'Dashboard' }}
        title="Project Stakeholder Assignments"
        subtitle="Manage and oversee implementing agencies and monitoring officers designated to execute MPLADS works"
        actions={
          <button onClick={reload} className="btn-secondary" title="Refresh assignments">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      <ErrorBanner error={error} onRetry={reload} className="mb-4" />

      {/* Overview Metric Cards */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-navy-600">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
              <ListChecks className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{data?.projects?.length || 0}</div>
              <div className="text-xs font-medium text-slate-500">Total Live Projects</div>
            </div>
          </div>
        </Card>

        <Card className="border-l-4 border-l-blue-600">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{agencies.length}</div>
              <div className="text-xs font-medium text-slate-500">Active Implementing Agencies</div>
            </div>
          </div>
        </Card>

        <Card className="border-l-4 border-l-emerald-600">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{officers.length}</div>
              <div className="text-xs font-medium text-slate-500">Designated Monitoring Officers</div>
            </div>
          </div>
        </Card>

        <Card className="border-l-4 border-l-purple-600">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-700">
              <History className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{history.length}</div>
              <div className="text-xs font-medium text-slate-500">Reassignments Audited</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Projects Assignment Table */}
      <Card pad={false}>
        <div className="p-4 border-b border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Current Project Allocations</h3>
              <p className="text-xs text-slate-500">Review which stakeholders are responsible for delivering each work</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox value={q} onChange={setQ} placeholder="Filter by project code, name…" className="w-64" />
              <Select value={districtFilter} onChange={(e) => setDistrictFilter(e.target.value)} className="w-40">
                <option value="">All districts</option>
                {(meta.data?.districts || []).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        <DataTable
          rows={projects}
          rowKey={(r) => r.project_id}
          empty={<EmptyState title="No matching projects" hint="Try adjusting your search criteria." />}
          columns={[
            {
              key: 'project',
              header: 'Project Details',
              render: (r) => (
                <div className="max-w-xs">
                  <Link to={`/mp/projects/${r.project_id}`} className="font-semibold text-navy-700 hover:underline">
                    {r.name}
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                    <span className="font-mono text-slate-600">{r.project_code}</span>
                    <span>·</span>
                    <span>{r.category}</span>
                  </div>
                </div>
              ),
            },
            {
              key: 'agency',
              header: 'Assigned Implementing Agency',
              render: (r) => (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="font-medium text-slate-800 text-sm">
                    {r.agency_name || <span className="text-red-500">Unassigned</span>}
                  </span>
                </div>
              ),
            },
            {
              key: 'officer',
              header: 'Assigned Monitoring Officer',
              render: (r) => (
                <div className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="text-slate-800 text-sm">
                    {r.officer_name || <span className="text-red-500">Unassigned</span>}
                  </span>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status & Progress',
              render: (r) => (
                <div className="w-32">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <StatusBadge status={r.status} />
                    <span className="font-semibold text-slate-700">{pct(r.progress)}</span>
                  </div>
                  <ProgressBar value={r.progress} />
                </div>
              ),
            },
            {
              key: 'actions',
              header: 'Action',
              render: (r) => (
                <button
                  onClick={() => openReassign(r)}
                  className="btn-secondary btn-sm whitespace-nowrap text-navy-700 hover:border-navy-500"
                >
                  Reassign
                </button>
              ),
            },
          ]}
        />
      </Card>

      {/* Assignment History Section */}
      <Card className="mt-6" pad={false}>
        <div className="p-4 border-b border-slate-200">
          <CardHeader
            title="Chronological Reassignment Trail"
            subtitle="Full accountability record of stakeholder modifications with recorded justifications"
            icon={History}
          />
        </div>
        <DataTable
          rows={history}
          rowKey={(h) => h.history_id}
          empty={<EmptyState title="No reassignment events" hint="All works are operating under initial commissioning assignments." />}
          columns={[
            {
              key: 'time',
              header: 'Timestamp',
              render: (h) => <span className="text-xs whitespace-nowrap text-slate-600">{fmtDateTime(h.created_at)}</span>,
            },
            {
              key: 'agency_change',
              header: 'Agency Transition',
              render: (h) => (
                h.previous_agency || h.new_agency ? (
                  <div className="text-xs">
                    <span className="text-slate-500">{h.previous_agency || 'Initial'}</span>
                    <span className="mx-1 text-slate-400">→</span>
                    <span className="font-semibold text-navy-700">{h.new_agency || 'Unassigned'}</span>
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">No change</span>
                )
              ),
            },
            {
              key: 'officer_change',
              header: 'Officer Transition',
              render: (h) => (
                h.previous_officer || h.new_officer ? (
                  <div className="text-xs">
                    <span className="text-slate-500">{h.previous_officer || 'Initial'}</span>
                    <span className="mx-1 text-slate-400">→</span>
                    <span className="font-semibold text-navy-700">{h.new_officer || 'Unassigned'}</span>
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">No change</span>
                )
              ),
            },
            {
              key: 'author',
              header: 'Changed By',
              render: (h) => <span className="text-xs font-medium text-slate-800">{h.changed_by || 'System'}</span>,
            },
            {
              key: 'reason',
              header: 'Recorded Rationale / Justification',
              render: (h) => <p className="text-xs text-slate-700 max-w-md line-clamp-2">{h.reason}</p>,
            },
          ]}
        />
      </Card>

      {/* Reassignment Modal */}
      {selectedProject && (
        <Modal
          open={reassignModalOpen}
          onClose={() => setReassignModalOpen(false)}
          title={`Reassign Stakeholders · ${selectedProject.project_code}`}
        >
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
              <div className="font-semibold text-slate-900">{selectedProject.name}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Current Agency: <b className="text-slate-700">{selectedProject.agency_name || 'None'}</b> ·
                Current Officer: <b className="text-slate-700">{selectedProject.officer_name || 'None'}</b>
              </div>
            </div>

            {formError && <Notice tone="red">{formError}</Notice>}

            <Field label="New Implementing Agency" required>
              <Select value={newAgencyId} onChange={(e) => setNewAgencyId(e.target.value)}>
                <option value="">Select Agency…</option>
                {agencies.map((a) => (
                  <option key={a.agency_id} value={a.agency_id}>{a.name}</option>
                ))}
              </Select>
            </Field>

            <Field label="New Monitoring Officer" required>
              <Select value={newOfficerId} onChange={(e) => setNewOfficerId(e.target.value)}>
                <option value="">Select Officer…</option>
                {officers.map((o) => (
                  <option key={o.user_id} value={o.user_id}>
                    {o.name} ({o.department || 'Monitoring Cell'})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Official Rationale / Justification" required>
              <Textarea
                rows={3}
                value={reassignReason}
                onChange={(e) => setReassignReason(e.target.value)}
                placeholder="Explain the necessity for reassigning this project (e.g. Agency capacity constraints, departmental restructuring, supervisory reallocation)…"
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button onClick={() => setReassignModalOpen(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={executeReassign} disabled={reassigning} className="btn-primary">
                {reassigning ? 'Updating…' : 'Confirm Reassignment'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
