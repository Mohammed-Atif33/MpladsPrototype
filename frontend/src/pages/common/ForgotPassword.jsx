import { useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { api } from '../../lib/api'
import { Field, Input, Notice, ErrorBanner } from '../../components/ui'

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setMsg('')
    try { setMsg((await api.post('/api/auth/forgot-password', { identifier })).message) }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-900 to-navy-600 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl sm:p-8">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-navy-100 text-navy-700"><KeyRound className="h-5 w-5" /></div>
        <h1>Forgot password</h1>
        <Notice tone="yellow" className="mt-3">Placeholder screen: password reset is not implemented in this prototype. Ask the system administrator to reset your password.</Notice>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <ErrorBanner error={error} />
          {msg && <Notice tone="green">{msg}</Notice>}
          <Field label="Email / User ID" required><Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} /></Field>
          <button className="btn-primary w-full" disabled={busy || !identifier}>Request reset</button>
        </form>
        <div className="mt-4 text-center"><Link to="/login" className="text-sm text-navy-700 hover:underline">← Back to login</Link></div>
      </div>
    </div>
  )
}
