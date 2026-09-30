import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { NOTIF_STYLES, notificationLink } from '../../lib/nav'
import { Card, PageHeader, Spinner, ErrorBanner, EmptyState, useApi } from '../../components/ui'
import { NotificationItem } from '../../components/layout/NotificationPanel'

export default function Notifications() {
  const { user, setUnread, refreshUnread } = useAuth()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const { data, loading, error, reload } = useApi(() => api.get('/api/notifications', { limit: 200 }), [])

  const items = (data?.items || []).filter((n) => filter === 'all' || (filter === 'unread' ? n.status === 'Unread' : n.priority === filter))
  const open = async (n) => {
    if (n.status === 'Unread') { try { await api.put(`/api/notifications/${n.notification_id}/read`) } catch { /* ignore */ } refreshUnread() }
    navigate(notificationLink(n, user.role))
  }
  const readAll = async () => { await api.put('/api/notifications/read-all'); setUnread(0); reload() }

  const filters = [['all', 'All'], ['unread', 'Unread'], ['info', 'Information'], ['review', 'Review'], ['action', 'Action required'], ['critical', 'Overdue / critical']]
  return (
    <>
      <PageHeader title="Notifications" subtitle="Blue = information · Yellow = review · Orange = action required · Red = overdue / critical"
        actions={<button className="btn-secondary" onClick={readAll}><CheckCheck className="h-4 w-4" /> Mark all read</button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        {filters.map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`pill ${filter === k ? 'bg-navy-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            {NOTIF_STYLES[k] && <span className={`h-2 w-2 rounded-full ${NOTIF_STYLES[k].dot}`} />}{l}
          </button>
        ))}
      </div>
      <ErrorBanner error={error} onRetry={reload} />
      <Card pad={false} className="overflow-hidden">
        {loading && !data ? <Spinner /> : items.length === 0 ? <EmptyState title="No notifications" hint="Nothing matches this filter." />
          : <div className="divide-y divide-slate-100">{items.map((n) => <NotificationItem key={n.notification_id} n={n} onOpen={open} />)}</div>}
      </Card>
    </>
  )
}
