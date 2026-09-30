// Thin fetch wrapper: bearer token from sessionStorage, friendly errors, 401 handling.
const BASE = import.meta.env.VITE_API_BASE || ''
const KEY = 'mplads_token'

let token = null
try { token = sessionStorage.getItem(KEY) } catch { /* storage blocked */ }

export function setToken(t) {
  token = t
  try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY) } catch { /* ignore */ }
}
export const getToken = () => token

export class ApiError extends Error {
  constructor(status, message, payload) {
    super(message)
    this.status = status
    this.payload = payload
    this.validation = payload && typeof payload.detail === 'object' ? payload.detail.validation : undefined
  }
}

function messageFrom(status, payload) {
  const d = payload && payload.detail
  if (typeof d === 'string') return d
  if (d && typeof d === 'object' && d.message) return d.message
  if (Array.isArray(d)) return d.map((x) => x.msg || x.message).join('; ')
  if (status === 0) return 'Cannot reach the server. Check your connection and try again.'
  if (status === 403) return 'You do not have permission to perform this action.'
  if (status === 404) return 'The requested item was not found.'
  if (status >= 500) return 'Something went wrong on the server. Please try again.'
  return 'The request could not be completed.'
}

function qs(params) {
  if (!params) return ''
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.append(k, v)
  })
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function request(method, path, { body, form, params, raw } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(`${BASE}${path}${qs(params)}`, { method, headers, body: payload })
  } catch {
    throw new ApiError(0, messageFrom(0))
  }
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, messageFrom(res.status, null))
    return res
  }
  let data = null
  const text = await res.text()
  if (text) { try { data = JSON.parse(text) } catch { data = null } }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/login')) {
      window.dispatchEvent(new CustomEvent('mplads:unauthorized', { detail: messageFrom(401, data) }))
    }
    throw new ApiError(res.status, messageFrom(res.status, data), data)
  }
  return data
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  del: (path) => request('DELETE', path),
  upload: (path, form, method = 'POST') => request(method, path, { form }),
}

// Files are protected by the API, so fetch with the bearer token and expose as an object URL.
export async function fetchBlobUrl(path) {
  const res = await request('GET', path, { raw: true })
  return URL.createObjectURL(await res.blob())
}

export async function openProtectedFile(path) {
  const url = await fetchBlobUrl(path)
  window.open(url, '_blank', 'noopener')
}

export async function downloadProtectedFile(path, filename) {
  const url = await fetchBlobUrl(path)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
