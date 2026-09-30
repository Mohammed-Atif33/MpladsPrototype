// Formatting helpers (Indian numbering: lakh / crore)
export function inr(v, { compact = true } = {}) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (Number.isNaN(n)) return '—'
  if (compact) {
    if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')} crore`
    if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.?0+$/, '')} lakh`
  }
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

export function inrFull(v) {
  if (v === null || v === undefined || v === '') return '—'
  return `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

export function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function timeAgo(v) {
  if (!v) return ''
  const s = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`
  return fmtDate(v)
}

export const pct = (v, d = 0) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(d)}%`)

export function pretty(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
