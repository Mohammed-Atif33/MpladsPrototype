import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(!!getToken())
  const [notice, setNotice] = useState('')
  const [unread, setUnread] = useState(0)

  const clear = useCallback((msg = '') => {
    setToken(null)
    setUser(null)
    setUnread(0)
    if (msg) setNotice(msg)
  }, [])

  // restore session (token in sessionStorage) - the role always comes back from the database via /auth/me
  useEffect(() => {
    if (!getToken()) return
    api.get('/api/auth/me')
      .then((u) => { setUser(u); setUnread(u.unread_notifications || 0) })
      .catch(() => clear())
      .finally(() => setLoading(false))
  }, [clear])

  // any 401 from the API (expired / revoked token) logs the user out
  useEffect(() => {
    const h = (e) => clear(e.detail || 'Your session has expired. Please log in again.')
    window.addEventListener('mplads:unauthorized', h)
    return () => window.removeEventListener('mplads:unauthorized', h)
  }, [clear])

  const login = useCallback(async (identifier, password) => {
    const res = await api.post('/api/auth/login', { identifier, password })
    setToken(res.access_token)
    setUser(res.user)
    setUnread(res.user.unread_notifications || 0)
    setNotice('')
    return res.user
  }, [])

  const register = useCallback(async (payload) => {
    const res = await api.post('/api/auth/register', payload)
    setToken(res.access_token)
    setUser(res.user)
    setUnread(res.user.unread_notifications || 0)
    setNotice('')
    return res.user
  }, [])

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout') } catch { /* token may already be invalid */ }
    clear()
  }, [clear])

  const refreshUnread = useCallback(async () => {
    try { const r = await api.get('/api/notifications/unread-count'); setUnread(r.unread) } catch { /* ignore */ }
  }, [])

  const value = useMemo(() => ({
    user, loading, notice, setNotice, unread, setUnread, refreshUnread, login, register, logout,
    can: (perm) => !!user && user.permissions.includes(perm),
  }), [user, loading, notice, unread, login, register, logout, refreshUnread])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
