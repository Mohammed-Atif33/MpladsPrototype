import {
  LayoutDashboard, Search, MessageSquareWarning, PlusCircle, Bell, FolderKanban, FileUp, ClipboardCheck, Briefcase,
  ClipboardList, Gavel, ScrollText, Map, Users, ShieldAlert, Scale, Inbox, HelpCircle, ListChecks,
  Eye, AlertTriangle, BarChart3, Globe,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export const ROLE = { CITIZEN: 'Citizen', AGENCY: 'Implementing Agency', OFFICER: 'Officer', HEAD: 'Head Officer', ADMIN: 'Admin', MP: 'MP' }

export const HOME = { [ROLE.CITIZEN]: '/citizen', [ROLE.AGENCY]: '/agency', [ROLE.OFFICER]: '/officer', [ROLE.HEAD]: '/head', [ROLE.ADMIN]: '/admin', [ROLE.MP]: '/mp' }

// Role-specific menus - each role sees different pages. (The API enforces the same rules server-side.)
export const NAV = {
  [ROLE.CITIZEN]: [
    { to: '/citizen', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/citizen/projects', label: 'Find Projects', icon: Search },
    { to: '/citizen/complaints', label: 'My Complaints', icon: MessageSquareWarning, end: true },
    { to: '/citizen/complaints/new', label: 'Submit Complaint', icon: PlusCircle },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: true },
  ],
  [ROLE.AGENCY]: [
    { to: '/agency', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/agency/projects', label: 'Assigned Projects', icon: FolderKanban },
    { to: '/agency/requests', label: 'Extension & Budget Requests', icon: ClipboardList },
    { to: '/agency/complaints', label: 'Complaints', icon: MessageSquareWarning },
    { to: '/agency/clarifications', label: 'Clarifications', icon: HelpCircle },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: true },
  ],
  [ROLE.OFFICER]: [
    { to: '/officer', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/officer/upload', label: 'Upload Project PDF', icon: FileUp },
    { to: '/officer/extractions', label: 'Verification Queue', icon: ClipboardCheck },
    { to: '/officer/projects', label: 'Projects & Risk', icon: FolderKanban },
    { to: '/officer/complaints', label: 'Complaints', icon: MessageSquareWarning },
    { to: '/officer/requests', label: 'Agency Requests', icon: Inbox },
    { to: '/officer/inspections', label: 'Inspections', icon: Briefcase },
    { to: '/officer/decisions', label: 'Decisions', icon: Gavel },
    { to: '/officer/map', label: 'Project Map', icon: Map },
    { to: '/officer/audit', label: 'Audit Trail', icon: ScrollText },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: true },
  ],
  [ROLE.HEAD]: [
    { to: '/head', label: 'Supervisory Dashboard', icon: LayoutDashboard, end: true },
    { to: '/head/cases', label: 'Escalated & High-Risk', icon: ShieldAlert },
    { to: '/head/projects', label: 'All Projects', icon: FolderKanban },
    { to: '/head/complaints', label: 'Complaints & Appeals', icon: Scale },
    { to: '/head/inspections', label: 'Inspections', icon: Briefcase },
    { to: '/head/decisions', label: 'Decisions', icon: Gavel },
    { to: '/head/map', label: 'Project Map', icon: Map },
    { to: '/head/audit', label: 'Audit & Trends', icon: ScrollText },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: true },
  ],
  [ROLE.ADMIN]: [
    { to: '/admin', label: 'Users & Audit', icon: Users, end: true },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: true },
  ],
  [ROLE.MP]: [
    { to: '/mp', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/mp/create-project', label: 'Create New Project', icon: PlusCircle },
    { to: '/mp/projects', label: 'My Projects', icon: FolderKanban },
    { to: '/mp/assignments', label: 'Project Assignments', icon: ListChecks },
    { to: '/mp/reports', label: 'Agency Reports', icon: ClipboardList },
    { to: '/mp/requests', label: 'Requests', icon: Inbox },
    { to: '/mp/complaints', label: 'Complaints', icon: MessageSquareWarning },
    { to: '/mp/inspections', label: 'Inspections', icon: Briefcase },
    { to: '/mp/risk', label: 'Risk Overview', icon: AlertTriangle },
    { to: '/mp/transparency', label: 'Public Transparency', icon: Globe },
    { to: '/mp/map', label: 'Project Map', icon: Map },
    { to: '/mp/audit', label: 'Audit Trail', icon: ScrollText },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: true },
  ],
}

/** Base path for pages shared between Officer and Head Officer (e.g. `${base}/projects/12`). */
export function useBasePath() {
  const { user } = useAuth()
  return user ? HOME[user.role] : ''
}

/** Where a notification should take the user. */
export function notificationLink(n, role) {
  if (role === ROLE.OFFICER || role === ROLE.HEAD) {
    const base = HOME[role]
    if (n.entity_type === 'Extraction') return `${base}/extractions/${n.entity_id}`
    if (n.project_id) return `${base}/projects/${n.project_id}`
    return `${base}/complaints`
  }
  if (role === ROLE.AGENCY) {
    if (n.entity_type === 'Clarification') return '/agency/clarifications'
    if (n.entity_type === 'Complaint') return '/agency/complaints'
    if (n.project_id) return `/agency/projects/${n.project_id}`
    return '/agency'
  }
  if (role === ROLE.CITIZEN) {
    if (n.entity_type === 'Complaint' && n.entity_id) return `/citizen/complaints/${n.entity_id}`
    if (n.project_id) return `/citizen/projects/${n.project_id}`
    return '/citizen/complaints'
  }
  if (role === ROLE.MP) {
    if (n.project_id) return `/mp/projects/${n.project_id}`
    return '/mp'
  }
  return '/notifications'
}

export const RISK_COLOURS = { Low: '#16a34a', Medium: '#eab308', High: '#f97316', Critical: '#dc2626' }
export const NOTIF_STYLES = {
  info: { label: 'Information', dot: 'bg-blue-500', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
  review: { label: 'Review', dot: 'bg-yellow-400', bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800' },
  action: { label: 'Action required', dot: 'bg-orange-500', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
  critical: { label: 'Overdue / critical', dot: 'bg-red-600', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' },
}
