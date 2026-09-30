import { useState } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { fmtDateTime } from '../../lib/format'
import { Card, CardHeader, PageHeader, KeyValue, Field, Input, ErrorBanner, Notice, Pill } from '../../components/ui'

export default function Profile() {
  const { user } = useAuth()
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const change = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(''); setError('')
    try {
      await api.post('/api/auth/change-password', { current_password: cur, new_password: next })
      setMsg('Password updated.'); setCur(''); setNext('')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <>
      <PageHeader title="My Profile" subtitle="Your account details as stored in the database." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account" />
          <KeyValue items={[
            ['Name', user.name], ['Email', user.email], ['Role', <Pill tone="blue">{user.role}</Pill>],
            user.agency_name && ['Agency', user.agency_name], ['Department', user.department], ['District', user.district],
            ['Constituency', user.constituency], ['Last login', fmtDateTime(user.last_login)], ['Status', user.status],
          ]} />
          <Notice className="mt-4">Your role and permissions are managed by the administrator and cannot be changed from this screen.</Notice>
        </Card>
        <Card>
          <CardHeader title="Change password" />
          <form onSubmit={change} className="space-y-3">
            <ErrorBanner error={error} />
            {msg && <Notice tone="green">{msg}</Notice>}
            <Field label="Current password"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
            <Field label="New password" hint="At least 8 characters."><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
            <button className="btn-primary" disabled={busy || !cur || next.length < 8}>Update password</button>
          </form>
        </Card>
      </div>
    </>
  )
}
