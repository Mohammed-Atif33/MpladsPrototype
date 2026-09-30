import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../lib/api'
import { HOME } from '../../lib/nav'
import { Field, Input, ErrorBanner, Notice } from '../../components/ui'

const RULE = 'At least 8 characters, with a letter and a number.'

export default function Register() {
  const { user, register } = useAuth()
  const navigate = useNavigate()
  const [cfg, setCfg] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => { api.get('/api/auth/config').then(setCfg).catch(() => setCfg({ signup_enabled: true })) }, [])
  if (user) return <Navigate to={HOME[user.role] || '/'} replace />

  const passwordOk = form.password.length >= 8 && /[A-Za-z]/.test(form.password) && /\d/.test(form.password)
  const match = form.password === form.confirm
  const valid = form.name.trim().length >= 2 && /\S+@\S+\.\S{2,}/.test(form.email) && passwordOk && match

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password })
      navigate('/citizen', { replace: true })          // self-registration always creates a Citizen
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-900 via-navy-800 to-navy-600 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl sm:p-8">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-navy-100 text-navy-700"><UserPlus className="h-5 w-5" /></div>
        <h1>Create a citizen account</h1>
        <p className="mt-1 text-sm text-slate-500">Follow public projects, post reviews and submit complaints.</p>

        {cfg && !cfg.signup_enabled ? (
          <Notice tone="yellow" className="mt-4">Self-registration is turned off. Please contact the administrator to get an account.</Notice>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
            <ErrorBanner error={error} />
            <Field label="Full name" required><Input value={form.name} onChange={set('name')} autoComplete="name" autoFocus /></Field>
            <Field label="Email" required><Input type="email" value={form.email} onChange={set('email')} autoComplete="email" placeholder="you@example.com" /></Field>
            <Field label="Password" required hint={RULE} error={form.password && !passwordOk ? RULE : ''}>
              <Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
            </Field>
            <Field label="Confirm password" required error={form.confirm && !match ? 'Passwords do not match.' : ''}>
              <Input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
            </Field>
            <button className="btn-primary w-full" disabled={busy || !valid}>{busy ? 'Creating account…' : 'Create account'}</button>
            <p className="text-xs text-slate-500">This creates a <b>Citizen</b> account. Officers, Head Officers and implementing agencies are added by the administrator; you cannot choose a role here.</p>
          </form>
        )}
        <div className="mt-4 text-center text-sm">Already registered? <Link to="/login" className="text-navy-700 hover:underline">Log in</Link></div>
      </div>
    </div>
  )
}
