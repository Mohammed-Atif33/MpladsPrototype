import { useMemo, useState } from 'react'
import { Copy, KeyRound, Pencil, ShieldCheck, UserCheck, UserPlus, UserX, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { ROLE } from '../../lib/nav'
import {
  Card, CardHeader, Checkbox, ConfirmDialog, DataTable, ErrorBanner, Field, Input, KpiCard, Modal, Notice, PageHeader, Pill, SearchBox,
  Select, Spinner, StatusBadge, useApi, useDebounced, useToast,
} from '../../components/ui'

const ROLES = [ROLE.CITIZEN, ROLE.AGENCY, ROLE.OFFICER, ROLE.HEAD, ROLE.ADMIN]
const ROLE_TONE = { Citizen: 'green', 'Implementing Agency': 'blue', Officer: 'yellow', 'Head Officer': 'purple', Admin: 'slate' }
const ROLE_HELP = {
  Citizen: 'Public portal: search projects, review, complain, track, appeal.',
  'Implementing Agency': 'Sees only its own agency\'s projects; reports progress, raises requests, answers complaints/clarifications.',
  Officer: 'Uploads/verifies PDFs, runs analysis, screens complaints, records decisions. Can be flagged as a field inspector.',
  'Head Officer': 'Supervises escalated cases, assigns inspections, decides appeals, runs supervisory checks.',
  Admin: 'Manages user accounts and roles. Sees the audit overview. No access to project decisions.',
}

function CopyBox({ value }) {
  const toast = useToast()
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
      <code className="flex-1 select-all text-base font-semibold tracking-wide text-slate-900">{value}</code>
      <button className="btn-secondary btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(value); toast('Copied to clipboard') } catch { toast('Copy failed - select and copy manually', 'error') } }}>
        <Copy className="h-3.5 w-3.5" /> Copy
      </button>
    </div>
  )
}

/** Create / edit form (email is fixed once created). */
function UserFormModal({ open, onClose, editing, agencies, onDone, selfId }) {
  const toast = useToast()
  const blank = { name: '', email: '', role: ROLE.OFFICER, agency_id: '', department: '', district: '', constituency: '', is_inspector: false, password: '', reason: '' }
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lastKey, setLastKey] = useState(null)
  const key = open ? (editing ? `e${editing.user_id}` : 'new') : null
  if (key !== lastKey) {          // reset the form whenever the modal is (re)opened for a different user
    setLastKey(key)
    setError('')
    setForm(editing ? { ...blank, ...Object.fromEntries(Object.entries(editing).map(([k, v]) => [k, v ?? ''])), agency_id: editing.agency_id || '' } : blank)
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const isEdit = !!editing
  const roleChanged = isEdit && form.role !== editing.role
  const isSelf = isEdit && editing.user_id === selfId

  const submit = async () => {
    setBusy(true); setError('')
    try {
      const body = {
        name: form.name.trim(), role: form.role, agency_id: form.role === ROLE.AGENCY ? Number(form.agency_id) || null : null,
        department: form.department || null, district: form.district || null, constituency: form.constituency || null,
        is_inspector: form.role === ROLE.OFFICER && !!form.is_inspector,
      }
      let res
      if (isEdit) res = await api.put(`/api/users/${editing.user_id}`, { ...body, reason: form.reason || undefined })
      else res = await api.post('/api/users', { ...body, email: form.email.trim(), password: form.password || undefined })
      toast(isEdit ? 'User updated.' : 'User created.')
      onDone(res, !isEdit)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const valid = form.name.trim().length >= 2 && (isEdit || /\S+@\S+\.\S{2,}/.test(form.email)) && (form.role !== ROLE.AGENCY || form.agency_id)
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit user – ${editing.name}` : 'Add user'} size="md"
      footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !valid}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}</button></>}>
      <div className="space-y-3">
        <ErrorBanner error={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" required><Input value={form.name} onChange={set('name')} /></Field>
          <Field label="Email" required hint={isEdit ? 'Email cannot be changed.' : 'Used to log in.'}><Input type="email" value={form.email} onChange={set('email')} disabled={isEdit} /></Field>
        </div>
        <Field label="Role" required hint={ROLE_HELP[form.role]}>
          <Select value={form.role} onChange={set('role')} disabled={isSelf}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
        </Field>
        {roleChanged && <Notice tone="orange">Changing the role takes effect immediately, even for a user who is logged in. The change is recorded in the audit trail.</Notice>}
        {form.role === ROLE.AGENCY && (
          <Field label="Implementing agency" required hint="Agency users only ever see this agency's projects.">
            <Select value={form.agency_id} onChange={set('agency_id')}><option value="">Select agency…</option>
              {agencies.map((a) => <option key={a.agency_id} value={a.agency_id}>{a.name}</option>)}</Select>
          </Field>
        )}
        {form.role === ROLE.OFFICER && (
          <Checkbox checked={!!form.is_inspector} onChange={(v) => setForm((f) => ({ ...f, is_inspector: v }))} label="Field inspector" hint="Can be assigned inspections by the Head Officer." />
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Department"><Input value={form.department} onChange={set('department')} /></Field>
          <Field label="District"><Input value={form.district} onChange={set('district')} /></Field>
          <Field label="Constituency"><Input value={form.constituency} onChange={set('constituency')} /></Field>
        </div>
        {!isEdit && (
          <Field label="Initial password" hint="Leave blank to generate a one-time password (shown once after creation). 8+ characters with a letter and a number.">
            <Input type="text" value={form.password} onChange={set('password')} autoComplete="off" placeholder="Auto-generate" />
          </Field>
        )}
        {isEdit && <Field label="Reason (optional)" hint="Stored in the audit trail."><Input value={form.reason} onChange={set('reason')} /></Field>}
      </div>
    </Modal>
  )
}

export default function Admin() {
  const { user: me } = useAuth()
  const toast = useToast()
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 250)
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const users = useApi(() => api.get('/api/users', { q: dq, role, status }), [dq, role, status])
  const all = useApi(() => api.get('/api/users'), [])
  const meta = useApi(() => api.get('/api/meta'), [])
  const audit = useApi(async () => {
    const r = await api.get('/api/audit-logs', { entity_type: 'User', page_size: 60 })
    const noise = new Set(['Login', 'Logout', 'Login Failed'])   // sessions are not account changes
    return { ...r, items: r.items.filter((x) => !noise.has(x.action)).slice(0, 12) }
  }, [])
  const chain = useApi(() => api.get('/api/audit-logs/verify-chain'), [])

  const [form, setForm] = useState({ open: false, editing: null })
  const [confirm, setConfirm] = useState(null)         // { user, action: 'disable'|'enable'|'reset' }
  const [resetPw, setResetPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [credential, setCredential] = useState(null)   // { title, email, password }

  const counts = useMemo(() => {
    const a = all.data || []
    return { total: a.length, active: a.filter((u) => u.status === 'Active').length, disabled: a.filter((u) => u.status !== 'Active').length }
  }, [all.data])
  const reload = () => { users.reload(); all.reload(); audit.reload(); chain.reload() }

  const runConfirm = async () => {
    const { user, action } = confirm
    setBusy(true); setError('')
    try {
      if (action === 'reset') {
        const r = await api.post(`/api/users/${user.user_id}/reset-password`, { new_password: resetPw || undefined })
        setCredential(r.temporary_password ? { title: 'Password reset', email: user.email, password: r.temporary_password } : null)
        toast(r.temporary_password ? 'Password reset. Copy the temporary password now.' : 'Password updated.')
      } else {
        await api.put(`/api/users/${user.user_id}`, { status: action === 'disable' ? 'Disabled' : 'Active' })
        toast(action === 'disable' ? `${user.name} was disabled and signed out.` : `${user.name} was re-enabled.`)
      }
      setConfirm(null); setResetPw(''); reload()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const columns = [
    { key: 'name', header: 'User', render: (u) => <div><div className="font-medium text-slate-900">{u.name}{u.user_id === me.user_id && <span className="ml-1.5 text-xs text-slate-400">(you)</span>}</div><div className="text-xs text-slate-500">{u.email}</div></div> },
    { key: 'role', header: 'Role', render: (u) => <div><Pill tone={ROLE_TONE[u.role]}>{u.role}</Pill>{u.is_inspector && <Pill tone="orange" className="ml-1">Inspector</Pill>}</div> },
    { key: 'agency', header: 'Agency / department', render: (u) => <div className="text-sm">{u.agency || u.department || '—'}<div className="text-xs text-slate-400">{u.district || ''}</div></div> },
    { key: 'status', header: 'Status', render: (u) => <div><StatusBadge status={u.status} />{u.locked && <Pill tone="orange" className="ml-1">Locked</Pill>}</div> },
    { key: 'last_login', header: 'Last login', render: (u) => <span className="text-xs text-slate-500">{u.last_login ? fmtDateTime(u.last_login) : 'Never'}</span> },
    { key: 'actions', header: '', render: (u) => (
      <div className="flex justify-end gap-1">
        <button className="btn-ghost btn-sm" title="Edit" onClick={() => setForm({ open: true, editing: u })}><Pencil className="h-4 w-4" /></button>
        <button className="btn-ghost btn-sm" title="Reset password" onClick={() => { setError(''); setResetPw(''); setConfirm({ user: u, action: 'reset' }) }}><KeyRound className="h-4 w-4" /></button>
        {u.user_id !== me.user_id && (u.status === 'Active'
          ? <button className="btn-ghost btn-sm text-red-600" title="Disable" onClick={() => { setError(''); setConfirm({ user: u, action: 'disable' }) }}><UserX className="h-4 w-4" /></button>
          : <button className="btn-ghost btn-sm text-green-700" title="Enable" onClick={() => { setError(''); setConfirm({ user: u, action: 'enable' }) }}><UserCheck className="h-4 w-4" /></button>)}
      </div>) },
  ]

  return (
    <>
      <PageHeader title="User management" subtitle="Create accounts, change roles, disable users and reset passwords. Roles live in the database and take effect immediately."
        actions={<button className="btn-primary" onClick={() => setForm({ open: true, editing: null })}><UserPlus className="h-4 w-4" /> Add user</button>} />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Users" value={counts.total} icon={Users} />
        <KpiCard label="Active" value={counts.active} icon={UserCheck} tone="green" />
        <KpiCard label="Disabled" value={counts.disabled} icon={UserX} tone={counts.disabled ? 'red' : 'slate'} />
        <KpiCard label="Audit chain integrity" value={chain.data ? (chain.data.valid ? 'Intact' : 'BROKEN') : '…'} icon={ShieldCheck} tone={chain.data?.valid === false ? 'red' : 'purple'} hint={chain.data ? `${chain.data.checked} records` : ''} />
      </div>

      <Notice className="mb-4">
        Citizens can sign up themselves (always as <b>Citizen</b>). Every other role — Agency, Officer, Head Officer, Admin — can only be created or changed here.
        Accounts are disabled, never deleted, so the audit history stays meaningful.
      </Notice>

      <Card pad={false} className="mb-6">
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <SearchBox value={q} onChange={setQ} placeholder="Search name or email…" />
          <Select value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option>Active</option><option>Disabled</option></Select>
        </div>
        <ErrorBanner error={users.error} className="mx-4 mb-3" />
        {users.loading && !users.data ? <Spinner /> : <DataTable rows={users.data || []} rowKey={(r) => r.user_id} columns={columns} />}
      </Card>

      <Card pad={false}>
        <div className="p-4"><CardHeader title="Recent account activity" subtitle="Sign-ups, creations, role changes, disables and password resets (from the audit trail)." /></div>
        <DataTable rows={audit.data?.items || []} rowKey={(r) => r.audit_id} columns={[
          { key: 'timestamp', header: 'When', render: (r) => <span className="text-xs">{fmtDateTime(r.timestamp)}</span> },
          { key: 'user', header: 'By', render: (r) => r.user || 'System' },
          { key: 'action', header: 'Action', render: (r) => <Pill tone="blue">{r.action}</Pill> },
          { key: 'entity_id', header: 'Target user #', render: (r) => r.entity_id },
          { key: 'new_value', header: 'Change', render: (r) => <span className="text-xs text-slate-500">{JSON.stringify(r.new_value)}</span> },
        ]} />
      </Card>

      <UserFormModal open={form.open} editing={form.editing} agencies={meta.data?.agencies || []} selfId={me.user_id}
        onClose={() => setForm({ open: false, editing: null })}
        onDone={(res, created) => {
          setForm({ open: false, editing: null }); reload()
          if (created && res.temporary_password) setCredential({ title: 'Account created', email: res.email, password: res.temporary_password })
        }} />

      <ConfirmDialog open={!!confirm} busy={busy} onCancel={() => setConfirm(null)} onConfirm={runConfirm}
        tone={confirm?.action === 'disable' ? 'danger' : 'primary'}
        title={confirm?.action === 'reset' ? 'Reset password' : confirm?.action === 'disable' ? 'Disable this account?' : 'Re-enable this account?'}
        confirmLabel={confirm?.action === 'reset' ? 'Reset password' : confirm?.action === 'disable' ? 'Disable' : 'Enable'}
        message={confirm && (confirm.action === 'reset'
          ? `Set a new password for ${confirm.user.name} (${confirm.user.email}). Their current password stops working immediately.`
          : confirm.action === 'disable' ? `${confirm.user.name} will be signed out at once and will not be able to log in until you re-enable the account.`
            : `${confirm.user.name} will be able to log in again.`)}>
        <ErrorBanner error={error} className="mt-3" />
        {confirm?.action === 'reset' && (
          <Field className="mt-3" label="New password" hint="Leave blank to generate a one-time password.">
            <Input value={resetPw} onChange={(e) => setResetPw(e.target.value)} autoComplete="off" placeholder="Auto-generate" />
          </Field>
        )}
      </ConfirmDialog>

      <Modal open={!!credential} onClose={() => setCredential(null)} title={credential?.title} size="sm"
        footer={<button className="btn-primary" onClick={() => setCredential(null)}>Done</button>}>
        {credential && (
          <>
            <p className="text-sm text-slate-600">Share these credentials with <b>{credential.email}</b> securely. The password is shown <b>only once</b> — it is not stored in readable form. They can change it under <i>My Profile</i>.</p>
            <CopyBox value={credential.password} />
          </>
        )}
      </Modal>
    </>
  )
}
