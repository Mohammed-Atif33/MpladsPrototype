import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Landmark, LogIn, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../lib/api'
import { HOME } from '../../lib/nav'
import { Field, Input, ErrorBanner, Notice } from '../../components/ui'

export default function Login() {
  const { user, login, notice, setNotice } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cfg, setCfg] = useState(null)

  useEffect(() => { api.get('/api/auth/config').then(setCfg).catch(() => {}) }, [])

  if (user) return <Navigate to={HOME[user.role] || '/'} replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      const u = await login(identifier.trim(), password)
      // the role comes from the database; the user is redirected to that role's dashboard
      navigate(HOME[u.role] || '/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-900 via-navy-800 to-navy-600 p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl md:grid-cols-5">
        <div className="hidden flex-col justify-between bg-navy-900 p-8 text-white md:col-span-2 md:flex">
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-amber-400 text-navy-900"><Landmark className="h-6 w-6" /></div>
            <h2 className="mt-5 text-xl font-semibold !text-white">MPLADS Risk Intelligence Platform</h2>
            <p className="mt-2 text-sm text-navy-200">Role-based project monitoring, explainable risk analysis and an accountable audit trail for local area development projects.</p>
          </div>
          <div className="mt-8 space-y-2 text-xs text-navy-200">
            <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> Your role is loaded from the database when you sign in - there is no role selector.</div>
            <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> Risk scores are prioritisation signals, not proof of wrongdoing.</div>
          </div>
        </div>

        <div className="p-6 sm:p-8 md:col-span-3">
          <h1>Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use your registered email or user ID.</p>
          <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
            {(notice || location.state?.msg) && <Notice tone="yellow">{notice || location.state.msg}</Notice>}
            <ErrorBanner error={error} />
            <Field label="Email / User ID" required>
              <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoFocus placeholder="name@example.gov" />
            </Field>
            <Field label="Password" required>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            <button className="btn-primary w-full" disabled={busy || !identifier || !password}><LogIn className="h-4 w-4" /> {busy ? 'Signing in…' : 'Login'}</button>
            <div className="text-right"><Link to="/forgot-password" className="text-sm text-navy-700 hover:underline">Forgot password?</Link></div>
          </form>
          {cfg?.signup_enabled && (
            <div className="mt-4 rounded-md bg-navy-50 px-3 py-2.5 text-sm text-slate-700">
              New here? <Link to="/register" className="font-medium text-navy-700 hover:underline">Create a citizen account</Link>
              <span className="block text-xs text-slate-500">Officer, Head Officer and Agency accounts are created by the administrator.</span>
            </div>
          )}

          {cfg?.show_demo_credentials && (
            <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Demo accounts (development only)</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {cfg.demo_accounts.map((a) => (
                  <button key={a.email} type="button" className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs hover:border-navy-400"
                    onClick={() => { setIdentifier(a.email); setPassword(a.password) }}>
                    <div className="font-medium text-slate-800">{a.role}</div>
                    <div className="text-slate-500">{a.email}</div>
                  </button>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-slate-500">Click a card to fill the form. Password for all demo users: <code className="rounded bg-white px-1">{cfg.demo_accounts[0]?.password}</code></div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
