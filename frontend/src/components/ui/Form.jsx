import { useRef } from 'react'
import clsx from 'clsx'
import { Paperclip, X } from 'lucide-react'

export function Field({ label, hint, error, required, children, className }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}{required && <span className="text-red-600"> *</span>}</label>}
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export const Input = ({ className, ...p }) => <input className={clsx('input', className)} {...p} />
export const Textarea = ({ className, rows = 3, ...p }) => <textarea rows={rows} className={clsx('input', className)} {...p} />
export function Select({ className, children, ...p }) {
  return <select className={clsx('input pr-8', className)} {...p}>{children}</select>
}

/** Multi-file picker with a visible list. `accept` is a hint only - the server validates by content. */
export function FileInput({ files, onChange, multiple = false, accept, max = 3, label = 'Choose file' }) {
  const ref = useRef(null)
  const list = files || []
  const add = (e) => {
    const picked = Array.from(e.target.files || [])
    onChange(multiple ? [...list, ...picked].slice(0, max) : picked.slice(0, 1))
    if (ref.current) ref.current.value = ''
  }
  return (
    <div>
      <input ref={ref} type="file" className="hidden" multiple={multiple} accept={accept} onChange={add} />
      <button type="button" className="btn-secondary btn-sm" onClick={() => ref.current?.click()}>
        <Paperclip className="h-3.5 w-3.5" /> {label}
      </button>
      {list.length > 0 && (
        <ul className="mt-2 space-y-1">
          {list.map((f, i) => (
            <li key={i} className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
              <span className="truncate">{f.name} <span className="text-slate-400">({Math.round(f.size / 1024)} KB)</span></span>
              <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="Remove"><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Checkbox({ checked, onChange, label, hint, className }) {
  return (
    <label className={clsx('flex cursor-pointer items-start gap-2 text-sm', className)}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-navy-700 focus:ring-navy-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="text-slate-800">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </label>
  )
}

export function SearchBox({ value, onChange, placeholder = 'Search…', className }) {
  return <input type="search" className={clsx('input', className)} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
}
