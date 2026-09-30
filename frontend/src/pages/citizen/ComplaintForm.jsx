import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, EyeOff, Send } from 'lucide-react'
import { api } from '../../lib/api'
import { Card, Checkbox, ErrorBanner, Field, FileInput, Input, Notice, PageHeader, Select, Spinner, Textarea, useAction, useApi } from '../../components/ui'

const today = () => new Date().toISOString().slice(0, 10)

export default function CitizenComplaintForm() {
  const [sp] = useSearchParams()
  const projects = useApi(() => api.get('/api/projects', { page_size: 100 }), [])
  const cats = useApi(() => api.get('/api/complaints/categories'), [])

  const [projectId, setProjectId] = useState(sp.get('project') || '')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [incidentDate, setIncidentDate] = useState('')
  const [location, setLocation] = useState('')
  const [files, setFiles] = useState([])
  const [anonymous, setAnonymous] = useState(false)
  const [errors, setErrors] = useState({})
  const [done, setDone] = useState(null)

  const validate = () => {
    const e = {}
    if (!projectId) e.project = 'Select the project this complaint is about.'
    if (!category) e.category = 'Choose a category.'
    if (description.trim().length < 15) e.description = 'Please describe the problem in at least 15 characters.'
    if (incidentDate && incidentDate > today()) e.incidentDate = 'The date cannot be in the future.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const [send, { busy, error }] = useAction(async () => {
    if (!validate()) return
    const fd = new FormData()
    fd.append('category', category)
    fd.append('description', description.trim())
    fd.append('project_id', projectId)
    if (incidentDate) fd.append('incident_date', incidentDate)
    if (location.trim()) fd.append('location_text', location.trim())
    fd.append('anonymous', anonymous ? 'true' : 'false')
    files.forEach((f) => fd.append('files', f))
    setDone(await api.upload('/api/complaints', fd))
  })

  if (done) {
    return (
      <>
        <PageHeader title="Complaint submitted" />
        <Card className="mx-auto max-w-xl text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
          <h2 className="mt-3">Thank you - we have received your complaint</h2>
          <p className="mt-1 text-sm text-slate-600">Keep your tracking ID to follow progress at any time.</p>
          <div className="my-4 rounded-lg border-2 border-dashed border-navy-300 bg-navy-50 py-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Tracking ID</div>
            <div className="mt-1 font-mono text-2xl font-semibold tracking-wider text-navy-800">{done.tracking_id}</div>
          </div>
          <ul className="mx-auto mb-5 max-w-sm space-y-1 text-left text-sm text-slate-600">
            <li>1. An officer will screen your complaint.</li>
            <li>2. If verified, it is assigned to the implementing agency.</li>
            <li>3. You will be notified as it is investigated and resolved.</li>
          </ul>
          <div className="flex flex-wrap justify-center gap-2">
            <Link to={`/citizen/complaints/${done.complaint_id}`} className="btn-primary">Track this complaint</Link>
            <Link to="/citizen/complaints" className="btn-secondary">My complaints</Link>
          </div>
        </Card>
      </>
    )
  }

  const items = projects.data?.items || []
  return (
    <>
      <PageHeader title="Submit a Complaint" subtitle="Report a problem with a public project. An officer will screen it before it is sent to the agency."
        back={{ to: '/citizen/complaints', label: 'My complaints' }} />
      <form onSubmit={(e) => { e.preventDefault(); send() }} className="mx-auto max-w-3xl">
        <Card className="space-y-4">
          <ErrorBanner error={error} />
          {projects.loading && !projects.data ? <Spinner /> : (
            <Field label="Project" required error={errors.project}>
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Select a project…</option>
                {items.map((p) => <option key={p.project_id} value={p.project_id}>{p.project_code} — {p.name}</option>)}
              </Select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" required error={errors.category}>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Select a category…</option>
                {(cats.data || []).map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Date of incident / observation" error={errors.incidentDate}>
              <Input type="date" max={today()} value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Location details" hint="Landmark, ward or exact spot at the site (optional)."><Input value={location} maxLength={255} onChange={(e) => setLocation(e.target.value)} /></Field>
          <Field label="Description" required error={errors.description} hint={`${description.trim().length}/4000 characters`}>
            <Textarea rows={5} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} placeholder="What did you see? When? What is the impact?" />
          </Field>
          <Field label="Photos / video (optional)" hint="Up to 3 files: JPG, PNG, WebP, GIF or MP4 (max 10 MB each, video up to 25 MB).">
            <FileInput multiple max={3} files={files} onChange={setFiles} accept="image/jpeg,image/png,image/webp,image/gif,video/mp4" label="Add photo or video" />
          </Field>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <Checkbox checked={anonymous} onChange={setAnonymous} label={<span className="inline-flex items-center gap-1.5"><EyeOff className="h-4 w-4" /> Submit anonymously</span>}
              hint="Your identity is hidden from officers and agencies. You can still track the complaint from your own account." />
          </div>
          <Notice>Please do not include Aadhaar numbers or other sensitive personal data in your description or photos.</Notice>
          <div className="flex justify-end gap-2">
            <Link to="/citizen/complaints" className="btn-secondary">Cancel</Link>
            <button className="btn-primary" disabled={busy}><Send className="h-4 w-4" /> {busy ? 'Submitting…' : 'Submit complaint'}</button>
          </div>
        </Card>
      </form>
    </>
  )
}
