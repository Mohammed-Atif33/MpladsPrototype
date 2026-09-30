import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { CheckCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { NOTIF_STYLES, notificationLink } from '../../lib/nav'
import { timeAgo } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { Spinner, useApi } from '../ui'

export function NotificationItem({ n, onOpen }) {
  const s = NOTIF_STYLES[n.priority] || NOTIF_STYLES.info
  return (
    <button onClick={() => onOpen(n)}
      className={clsx('flex w-full items-start gap-3 border-l-4 px-3 py-2.5 text-left transition hover:brightness-95', s.bg,
        n.priority === 'info' ? 'border-blue-500' : n.priority === 'review' ? 'border-yellow-400' : n.priority === 'action' ? 'border-orange-500' : 'border-red-600',
        n.status === 'Read' && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={clsx('text-[10px] font-semibold uppercase tracking-wide', s.text)}>{s.label}</span>
          <span className="text-[10px] text-slate-500">· {n.type}</span>
          {n.status === 'Unread' && <span className="ml-auto h-2 w-2 rounded-full bg-navy-600" />}
        </div>
        <div className="mt-0.5 text-[13px] leading-snug text-slate-800">{n.message}</div>
        <div className="mt-0.5 text-[11px] text-slate-500">{timeAgo(n.created_at)}</div>
      </div>
    </button>
  )
}

export default function NotificationPanel({ onClose }) {
  const { user, setUnread, refreshUnread } = useAuth()
  const navigate = useNavigate()
  const { data, loading, reload } = useApi(() => api.get('/api/notifications', { limit: 8 }), [])

  const open = async (n) => {
    if (n.status === 'Unread') { try { await api.put(`/api/notifications/${n.notification_id}/read`) } catch { /* ignore */ } refreshUnread() }
    onClose()
    navigate(notificationLink(n, user.role))
  }
  const readAll = async () => { await api.put('/api/notifications/read-all'); setUnread(0); reload() }

  return (
    <div className="absolute right-0 top-11 z-50 w-[92vw] max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div className="text-sm font-semibold text-slate-800">Notifications</div>
        <button className="inline-flex items-center gap-1 text-xs text-navy-700 hover:underline" onClick={readAll}><CheckCheck className="h-3.5 w-3.5" /> Mark all read</button>
      </div>
      <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
        {loading && !data ? <Spinner /> : (data?.items || []).length === 0
          ? <div className="p-6 text-center text-sm text-slate-500">You're all caught up.</div>
          : data.items.map((n) => <NotificationItem key={n.notification_id} n={n} onOpen={open} />)}
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        <span className="flex gap-2">
          {Object.entries(NOTIF_STYLES).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1"><span className={clsx('h-2 w-2 rounded-full', v.dot)} />{v.label}</span>)}
        </span>
        <Link to="/notifications" onClick={onClose} className="font-medium text-navy-700 hover:underline">View all</Link>
      </div>
    </div>
  )
}
