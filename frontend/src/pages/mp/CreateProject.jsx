import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight, Building2, Calendar, CheckCircle2, DollarSign, FileCheck, FolderKanban,
  Landmark, MapPin, Plus, ShieldAlert, Sparkles, UserCheck,
} from 'lucide-react'
import { api } from '../../lib/api'
import { inr } from '../../lib/format'
import {
  Card, CardHeader, ErrorBanner, Field, Input, Notice, PageHeader, Select, Spinner,
  Textarea, useAction, useApi,
} from '../../components/ui'

const today = () => new Date().toISOString().slice(0, 10)
const defaultDeadline = () => {
  const d = new Date()
  d.setDate(d.getDate() + 365)
  return d.toISOString().slice(0, 10)
}

export default function MpCreateProject() {
  const navigate = useNavigate()
  const meta = useApi(() => api.get('/api/meta'), [])

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [type, setType] = useState('Civil Works')
  const [description, setDescription] = useState('')
  const [district, setDistrict] = useState('Pune')
  const [constituency, setConstituency] = useState('Pune')
  const [location, setLocation] = useState('')
  const [agencyId, setAgencyId] = useState('')
  const [officerId, setOfficerId] = useState('')
  const [sanctionedAmount, setSanctionedAmount] = useState('2500000')
  const [approvedBudget, setApprovedBudget] = useState('2500000')
  const [releasedAmount, setReleasedAmount] = useState('1000000')
  const [startDate, setStartDate] = useState(today())
  const [deadline, setDeadline] = useState(defaultDeadline())

  const [errors, setErrors] = useState({})
  const [createdProject, setCreatedProject] = useState(null)

  const calcDays = () => {
    if (!startDate || !deadline) return 0
    const diff = new Date(deadline) - new Date(startDate)
    return Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)))
  }

  const validate = () => {
    const errs = {}
    if (!name.trim()) errs.name = 'Please provide a clear project title.'
    if (!category) errs.category = 'Select a development category.'
    if (!location.trim()) errs.location = 'Provide a specific locality or location address.'
    if (!district) errs.district = 'Select the project district.'
    if (!constituency.trim()) errs.constituency = 'Specify the constituency.'
    if (!agencyId) errs.agencyId = 'Assign an implementing agency.'
    if (!officerId) errs.officerId = 'Assign a monitoring officer.'
    const sAmt = parseFloat(sanctionedAmount)
    if (isNaN(sAmt) || sAmt <= 0) errs.sanctionedAmount = 'Enter a valid sanctioned amount (greater than 0).'
    if (deadline <= startDate) errs.deadline = 'Completion deadline must be strictly after the start date.'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const [submitProject, { busy, error }] = useAction(async () => {
    if (!validate()) return
    const body = {
      name: name.trim(),
      category: category.trim(),
      type: type.trim() || undefined,
      description: description.trim() || undefined,
      location: location.trim(),
      district: district.trim(),
      constituency: constituency.trim(),
      agency_id: parseInt(agencyId, 10),
      officer_id: parseInt(officerId, 10),
      start_date: startDate,
      deadline: deadline,
      expected_days: calcDays(),
      sanctioned_amount: parseFloat(sanctionedAmount),
      approved_budget: approvedBudget ? parseFloat(approvedBudget) : parseFloat(sanctionedAmount),
      released_amount: releasedAmount ? parseFloat(releasedAmount) : 0,
      current_expenditure: 0,
      supporting_doc_ids: [],
    }
    const res = await api.post('/api/projects', body)
    setCreatedProject(res)
  })

  if (createdProject) {
    return (
      <div className="mx-auto max-w-2xl py-6">
        <Card className="border-emerald-200 bg-emerald-50/20 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h2 className="mt-4 text-2xl font-bold text-slate-900">Project Commissioned Successfully!</h2>
          <p className="mt-1 text-sm text-slate-600">
            The project has been registered under your constituency quota and assigned for execution.
          </p>

          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">Generated Project Code</div>
                <div className="text-lg font-bold text-navy-800">{createdProject.project_code}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">Sanctioned Budget</div>
                <div className="text-lg font-bold text-slate-900">{inr(createdProject.sanctioned_amount)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">Implementing Agency</div>
                <div className="text-sm font-semibold text-slate-800">{createdProject.agency || 'Assigned'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">Monitoring Officer</div>
                <div className="text-sm font-semibold text-slate-800">{createdProject.officer_name || 'Assigned'}</div>
              </div>
            </div>
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="text-xs uppercase tracking-wider text-slate-400">Project Title</div>
              <div className="text-sm font-medium text-slate-900">{createdProject.name}</div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to={`/mp/projects/${createdProject.project_id}`} className="btn-primary">
              <FolderKanban className="h-4 w-4" /> Open Project Case File
            </Link>
            <button
              onClick={() => {
                setCreatedProject(null)
                setName('')
                setLocation('')
                setDescription('')
              }}
              className="btn-secondary"
            >
              <Plus className="h-4 w-4" /> Commission Another Project
            </button>
            <Link to="/mp/assignments" className="btn-secondary">
              View All Assignments
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  const m = meta.data || {}
  const duration = calcDays()

  return (
    <>
      <PageHeader
        back={{ to: '/mp', label: 'Dashboard' }}
        title="Sanction New Constituency Project"
        subtitle="Commission local area infrastructure under MPLADS with assigned implementing stakeholders and audited accountability"
      />

      <ErrorBanner error={error} className="mb-4" />

      <form onSubmit={(e) => { e.preventDefault(); submitProject() }} className="space-y-6">
        {/* Section 1: Basic Information */}
        <Card>
          <CardHeader
            title="1. Project Scope & Category"
            subtitle="Define the work title, development domain, and descriptive scope"
            icon={FolderKanban}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project Title / Work Name" required error={errors.name} className="sm:col-span-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Construction of Community Hall and Skill Centre at Kothrud"
              />
            </Field>

            <Field label="Development Category" required error={errors.category}>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Select Category…</option>
                {(m.categories || [
                  'Road Development', 'Water Supply', 'School Building', 'Community Hall',
                  'Drainage & Sanitation', 'Street Lighting', 'Health Centre', 'Bridge / Culvert',
                ]).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>

            <Field label="Work Type / Classification">
              <Input
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="e.g. Civil Infrastructure, Solar Lighting, Pipeline"
              />
            </Field>

            <Field label="Scope & Public Purpose" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Provide detailed description of the proposed project, target community beneficiaries, and expected civic deliverables…"
              />
            </Field>
          </div>
        </Card>

        {/* Section 2: Geographic Location */}
        <Card>
          <CardHeader
            title="2. Constituency & Location"
            subtitle="Target district, parliamentary constituency, and physical site details"
            icon={MapPin}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="District" required error={errors.district}>
              <Select value={district} onChange={(e) => setDistrict(e.target.value)}>
                {(m.districts || ['Pune', 'Pimpri-Chinchwad', 'Satara', 'Kolhapur', 'Nashik']).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </Select>
            </Field>

            <Field label="Constituency" required error={errors.constituency}>
              <Input
                value={constituency}
                onChange={(e) => setConstituency(e.target.value)}
                placeholder="e.g. Pune"
              />
            </Field>

            <Field label="Specific Site / Ward / Locality" required error={errors.location}>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Near Mahatma Phule Ground, Kothrud"
              />
            </Field>
          </div>
        </Card>

        {/* Section 3: Stakeholder Assignment */}
        <Card className="border-navy-200 bg-slate-50/50">
          <CardHeader
            title="3. Stakeholder Assignment"
            subtitle="Designate the responsible executive agency and monitoring officer"
            icon={UserCheck}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Implementing Agency" required error={errors.agencyId}>
              <Select value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
                <option value="">Select Implementing Agency…</option>
                {(m.agencies || []).map((a) => (
                  <option key={a.agency_id} value={a.agency_id}>{a.name}</option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-slate-500">Agency executing the physical works and submitting weekly reports.</p>
            </Field>

            <Field label="Monitoring Officer" required error={errors.officerId}>
              <Select value={officerId} onChange={(e) => setOfficerId(e.target.value)}>
                <option value="">Select Monitoring Officer…</option>
                {(m.officers || []).map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.name} ({u.department || 'Monitoring Cell'})
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-slate-500">Officer conducting verifications, site inspections, and review checks.</p>
            </Field>
          </div>
        </Card>

        {/* Section 4: Financial Allocations & Timeline */}
        <Card>
          <CardHeader
            title="4. Budget Allocation & Timeline"
            subtitle="Constituency funds sanctioned, initial tranche, and project milestone dates"
            icon={DollarSign}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Sanctioned Amount (INR)" required error={errors.sanctionedAmount}>
              <Input
                type="number"
                min="10000"
                step="1000"
                value={sanctionedAmount}
                onChange={(e) => {
                  setSanctionedAmount(e.target.value)
                  if (!approvedBudget || approvedBudget === sanctionedAmount) {
                    setApprovedBudget(e.target.value)
                  }
                }}
              />
              <p className="mt-1 text-xs text-slate-500">Equivalent: {inr(parseFloat(sanctionedAmount) || 0)}</p>
            </Field>

            <Field label="Approved Technical Budget (INR)">
              <Input
                type="number"
                min="0"
                step="1000"
                value={approvedBudget}
                onChange={(e) => setApprovedBudget(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">Equivalent: {inr(parseFloat(approvedBudget) || 0)}</p>
            </Field>

            <Field label="Initial Released Funds (Tranche 1)">
              <Input
                type="number"
                min="0"
                step="1000"
                value={releasedAmount}
                onChange={(e) => setReleasedAmount(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">Initial disbursement for work mobilization.</p>
            </Field>

            <Field label="Commencement / Start Date" required>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>

            <Field label="Completion Deadline" required error={errors.deadline}>
              <Input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </Field>

            <div className="flex flex-col justify-center rounded-lg bg-navy-50 p-3">
              <div className="text-xs uppercase tracking-wider text-navy-700 font-semibold">Planned Duration</div>
              <div className="text-xl font-bold text-navy-900">{duration} days</div>
              <div className="text-xs text-slate-500">From start to targeted completion</div>
            </div>
          </div>
        </Card>

        {/* Submission actions */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <Link to="/mp" className="btn-secondary">
            Cancel
          </Link>
          <button type="submit" disabled={busy} className="btn-primary px-6 py-2.5 shadow-md">
            {busy ? (
              <span className="flex items-center gap-2">
                <Spinner className="!py-0" /> Commissioning Project…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Plus className="h-4 w-4" /> Commission & Sanction Project
              </span>
            )}
          </button>
        </div>
      </form>
    </>
  )
}
