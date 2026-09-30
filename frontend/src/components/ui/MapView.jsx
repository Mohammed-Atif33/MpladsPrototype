import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import { Link } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import { RISK_COLOURS } from '../../lib/nav'

const STATUS_COLOURS = { 'On track': '#16a34a', Delayed: '#f97316', Completed: '#2563eb' }

function Fit({ points }) {
  const map = useMap()
  useEffect(() => {
    if (points.length) map.fitBounds(points, { padding: [30, 30], maxZoom: 12 })
  }, [points, map])
  return null
}

/**
 * Leaflet map of projects. colorBy='status' (public: On track / Delayed / Completed) or 'risk' (officers only).
 * `linkTo(project)` builds the details link shown in the popup.
 */
export default function MapView({ projects = [], colorBy = 'status', linkTo, height = 420 }) {
  const pts = projects.filter((p) => p.latitude && p.longitude)
  const points = pts.map((p) => [p.latitude, p.longitude])
  const colour = (p) => (colorBy === 'risk' ? RISK_COLOURS[p.latest_risk?.risk_level] || '#64748b' : STATUS_COLOURS[p.public_status] || '#64748b')
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200" style={{ height }}>
      <MapContainer center={[18.52, 73.86]} zoom={9} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Fit points={points} />
        {pts.map((p) => (
          <CircleMarker key={p.project_id} center={[p.latitude, p.longitude]} radius={9}
            pathOptions={{ color: '#fff', weight: 2, fillColor: colour(p), fillOpacity: 0.95 }}>
            <Popup>
              <div className="min-w-[200px] text-sm">
                <div className="font-semibold text-slate-900">{p.name}</div>
                <div className="text-xs text-slate-500">{p.project_code} · {p.location}</div>
                <div className="mt-1.5 text-xs">Progress: <b>{p.progress}%</b></div>
                <div className="text-xs">Status: <b>{colorBy === 'risk' ? (p.status || p.public_status) : p.public_status}</b></div>
                {colorBy === 'risk' && p.latest_risk && <div className="text-xs">Risk: <b>{p.latest_risk.risk_level}</b> ({Math.round(p.latest_risk.risk_score)})</div>}
                {linkTo && <Link to={linkTo(p)} className="mt-2 inline-block text-xs font-medium text-navy-700 underline">View details →</Link>}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}

export function MapLegend({ colorBy = 'status' }) {
  const items = colorBy === 'risk'
    ? Object.entries(RISK_COLOURS)
    : Object.entries(STATUS_COLOURS)
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
      {items.map(([k, c]) => <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{k}</span>)}
    </div>
  )
}
