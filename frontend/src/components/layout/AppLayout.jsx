import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Bell, LogOut, Menu, UserCircle2, X, Landmark, Info } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { NAV } from '../../lib/nav'
import { ConfirmDialog } from '../ui'
import NotificationPanel from './NotificationPanel'

const ROLE_TONE = {
  Citizen: 'bg-emerald-500/20 text-emerald-100', 'Implementing Agency': 'bg-sky-500/20 text-sky-100',
  Officer: 'bg-amber-500/20 text-amber-100', 'Head Officer': 'bg-fuchsia-500/20 text-fuchsia-100', Admin: 'bg-slate-500/30 text-slate-100',
}

function Sidebar({ items, unread, onNavigate }) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end} onClick={onNavigate}
          className={({ isActive }) => clsx('group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition',
            isActive ? 'bg-white/15 text-white' : 'text-navy-100 hover:bg-white/10 hover:text-white')}>
          <it.icon className="h-4.5 w-4.5 h-[18px] w-[18px] shrink-0" />
          <span className="flex-1 truncate">{it.label}</span>
          {it.badge && unread > 0 && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
        </NavLink>
      ))}
    </nav>
  )
}

export default function AppLayout() {
  const { user, unread, refreshUnread, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const panelRef = useRef(null)
  const items = NAV[user.role] || []

  useEffect(() => { setMobileOpen(false); setPanelOpen(false) }, [location.pathname])

  // notification badge polling
  useEffect(() => {
    refreshUnread()
    const t = setInterval(refreshUnread, 25000)
    return () => clearInterval(t)
  }, [refreshUnread])

  useEffect(() => {
    const h = (e) => { if (panelOpen && panelRef.current && !panelRef.current.contains(e.target)) setPanelOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [panelOpen])

  const brand = (
    <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/10">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-400 text-navy-900"><Landmark className="h-5 w-5" /></div>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-white">MPLADS</div>
        <div className="text-[11px] text-navy-200">Risk Intelligence Platform</div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen">
      {/* desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-navy-900 lg:flex">
        {brand}
        <Sidebar items={items} unread={unread} />
        <div className="border-t border-white/10 p-3 text-[11px] leading-snug text-navy-300">
          Prototype · synthetic data only. Risk scores are prioritisation signals, not findings of wrongdoing.
        </div>
      </aside>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-navy-900">
            <div className="flex items-center justify-between pr-3">{brand}<button className="text-white" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button></div>
            <Sidebar items={items} unread={unread} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm">
          <button className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <div className="hidden items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 sm:flex">
            <Info className="h-3.5 w-3.5" /> Prototype · synthetic demo data
          </div>
          <div className="flex-1" />

          <div className="relative" ref={panelRef}>
            <button className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100" onClick={() => { setPanelOpen((o) => !o); refreshUnread() }} aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
            </button>
            {panelOpen && <NotificationPanel onClose={() => setPanelOpen(false)} />}
          </div>

          <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-100" onClick={() => navigate('/profile')}>
            <UserCircle2 className="h-7 w-7 text-navy-600" />
            <div className="hidden text-left leading-tight sm:block">
              <div className="text-sm font-medium text-slate-800">{user.name}</div>
              <div className="text-[11px] text-slate-500">{user.role}{user.agency_name ? ` · ${user.agency_name}` : ''}</div>
            </div>
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setConfirmLogout(true)}><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Logout</span></button>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      <ConfirmDialog open={confirmLogout} title="Log out?" message="You will be returned to the login page. Any unsaved input will be lost."
        confirmLabel="Log out" onCancel={() => setConfirmLogout(false)} onConfirm={async () => { setConfirmLogout(false); await logout(); navigate('/login') }} />
    </div>
  )
}
