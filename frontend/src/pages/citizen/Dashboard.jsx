import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Building2, CheckCircle2, AlertTriangle, MessageSquareWarning, Clock, Search, Star, PlusCircle, MessageSquare, Scale } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { Card, CardHeader, ErrorBanner, KpiCard, MapLegend, MapView, PageHeader, Spinner, useApi } from '../../components/ui'
import ProjectCard from '../../components/portal/ProjectCard'

const HELP = [
  { icon: Search, title: 'Search', text: 'Find projects near you by name, place, category or agency.' },
  { icon: Star, title: 'Review', text: 'Rate a project and share what you see on the ground.' },
  { icon: PlusCircle, title: 'Complain', text: 'Report a problem with photos - anonymously if you prefer.' },
  { icon: MessageSquare, title: 'Track', text: 'Follow your complaint from tracking ID to resolution.' },
  { icon: Scale, title: 'Feedback & appeal', text: 'Tell us if the fix worked, or appeal the outcome.' },
]

export default function CitizenDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const dash = useApi(() => api.get('/api/dashboard'), [])
  const projects = useApi(() => api.get('/api/projects', { page_size: 100 }), [])

  const items = projects.data?.items || []
  const featured = [...items.filter((p) => p.public_status === 'Delayed').slice(0, 3), ...items.filter((p) => p.public_status === 'On track').slice(0, 3)].slice(0, 6)
  const k = dash.data?.kpis

  const search = (e) => {
    e.preventDefault()
    navigate(`/citizen/projects${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
  }

  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="Follow public development projects in your area, share feedback and raise concerns." />

      <form onSubmit={search} className="card card-pad mb-5 flex flex-col gap-2 sm:flex-row">
        <input className="input flex-1" placeholder="Search projects by name, place or category…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
        <button className="btn-primary"><Search className="h-4 w-4" /> Search projects</button>
      </form>

      <ErrorBanner error={dash.error} onRetry={dash.reload} className="mb-4" />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Public projects" value={k?.public_projects} icon={Building2} to="/citizen/projects" />
        <KpiCard label="Completed" value={k?.completed} icon={CheckCircle2} tone="green" />
        <KpiCard label="Delayed" value={k?.delayed} icon={AlertTriangle} tone="orange" />
        <KpiCard label="My complaints" value={k?.my_complaints} icon={MessageSquareWarning} tone="purple" to="/citizen/complaints" />
        <KpiCard label="Open complaints" value={k?.open_complaints} icon={Clock} tone="yellow" to="/citizen/complaints" />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Project map" subtitle="Green = on track · Orange = delayed · Blue = completed" />
          {projects.loading && !projects.data ? <Spinner /> : <MapView projects={items} colorBy="status" linkTo={(p) => `/citizen/projects/${p.project_id}`} height={340} />}
          <MapLegend colorBy="status" />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Projects by category" />
          {dash.loading && !dash.data ? <Spinner /> : (
            <div className="h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dash.data?.by_category || []} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Projects" fill="#2d4f7e" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2>Featured projects</h2>
        <Link to="/citizen/projects" className="text-sm font-medium text-navy-700 hover:underline">See all projects →</Link>
      </div>
      <ErrorBanner error={projects.error} onRetry={projects.reload} />
      {projects.loading && !projects.data ? <Spinner /> : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{featured.map((p) => <ProjectCard key={p.project_id} p={p} />)}</div>
      )}

      <Card>
        <CardHeader title="What you can do here" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {HELP.map((h) => (
            <div key={h.title} className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-700"><h.icon className="h-4.5 w-4.5" /></div>
              <div><div className="text-sm font-semibold text-slate-800">{h.title}</div><div className="text-xs text-slate-500">{h.text}</div></div>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}
