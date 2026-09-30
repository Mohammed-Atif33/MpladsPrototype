import { Link } from 'react-router-dom'
import { MapPin, Building2, UserCheck, ShieldAlert } from 'lucide-react'
import { ProgressBar, StatusBadge, RiskBadge } from '../ui'
import { Stars } from './Stars'
import { inr } from '../../lib/format'

/** Public project card (citizen view: public transparency fields). */
export default function ProjectCard({ p }) {
  const spent = p.sanctioned_amount ? (p.expenditure / p.sanctioned_amount) * 100 : 0
  const hasRisk = p.risk_score !== null && p.risk_score !== undefined
  const officer = p.monitoring_officer_name || p.assigned_officer_name || p.officer_name || p.monitoring_officer || 'Not Assigned'
  const agency = p.agency_name || p.agency || 'Not Assigned'
  const displayStatus = p.public_status || p.status

  return (
    <Link to={`/citizen/projects/${p.project_id}`} className="card card-pad flex h-full flex-col transition hover:border-navy-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <h3 className="leading-snug">{p.name}</h3>
        <StatusBadge status={displayStatus} />
      </div>
      <div className="mt-1 text-xs text-slate-500 font-mono">{p.project_code} · {p.category}</div>

      {/* Responsibility & Location */}
      <div className="mt-2.5 space-y-1.5 text-xs text-slate-600 border-t border-slate-100 pt-2">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="truncate">{p.location || p.district}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="text-slate-500">Agency:</span>
          <span className="font-medium text-slate-700 truncate">{agency}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <UserCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="text-slate-500">Officer:</span>
          <span className="font-medium text-slate-700 truncate">{officer}</span>
        </div>
      </div>

      {/* Risk Transparency Badge & Score */}
      <div className="mt-3 flex items-center justify-between rounded-md bg-slate-50 p-2 text-xs border border-slate-200/80">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-slate-500 font-medium">Risk:</span>
          <span className="font-semibold text-slate-800">
            {hasRisk ? `${Number(p.risk_score).toFixed(0)} / 100` : 'Risk Analysis: Pending'}
          </span>
        </div>
        <RiskBadge level={p.risk_level} score={hasRisk ? p.risk_score : null} />
      </div>

      {/* Progress */}
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-slate-500">Progress</span>
          <b className="text-slate-800">{p.progress}%</b>
        </div>
        <ProgressBar value={p.progress} />
      </div>

      {/* Financials */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-slate-400">Sanctioned</div>
          <div className="font-semibold text-slate-800">{inr(p.sanctioned_amount)}</div>
        </div>
        <div>
          <div className="text-slate-400">Spent</div>
          <div className="font-semibold text-slate-800">
            {inr(p.expenditure)} <span className="font-normal text-slate-400">({spent.toFixed(0)}%)</span>
          </div>
        </div>
      </div>

      <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between">
        <Stars value={p.rating_avg} count={p.rating_count} />
        <span className="text-xs text-navy-700 font-medium hover:underline">View details →</span>
      </div>
    </Link>
  )
}
