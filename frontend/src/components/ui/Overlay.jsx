import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return
    const h = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size]
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={clsx('w-full rounded-lg bg-white shadow-xl', w)}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2>{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 rounded-b-lg">{footer}</div>}
      </div>
    </div>, document.body)
}

/** Confirmation dialog used before every consequential action (decisions, escalation, logout, ...). */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'primary', busy, onConfirm, onCancel, children }) {
  const cls = { primary: 'btn-primary', danger: 'btn-danger', warn: 'btn-warn', success: 'btn-success' }[tone]
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm"
      footer={<><button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={cls} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button></>}>
      {message && <p className="text-sm text-slate-600">{message}</p>}
      {children}
    </Modal>
  )
}

// ------------------------------------------------------------------ toasts
const ToastCtx = createContext(() => {})

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setItems((xs) => [...xs, { id, message, type }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => {
          const Icon = t.type === 'error' ? AlertTriangle : t.type === 'info' ? Info : CheckCircle2
          const tone = t.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : t.type === 'info' ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-green-200 bg-green-50 text-green-800'
          return (
            <div key={t.id} className={clsx('flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm shadow-lg', tone)}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{t.message}</span>
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)
