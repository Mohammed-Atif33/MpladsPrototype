import clsx from 'clsx'
import { Star } from 'lucide-react'

/** Read-only star rating (optionally with average and count). */
export function Stars({ value = 0, count, className }) {
  const v = Math.round(Number(value) || 0)
  return (
    <span className={clsx('inline-flex items-center gap-1', className)}>
      <span className="inline-flex">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={clsx('h-4 w-4', i <= v ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
        ))}
      </span>
      {count !== undefined && (
        <span className="text-xs text-slate-500">{count ? `${Number(value).toFixed(1)} (${count})` : 'No reviews yet'}</span>
      )}
    </span>
  )
}

export function StarInput({ value, onChange, label = 'Rating' }) {
  return (
    <div className="inline-flex" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i > 1 ? 's' : ''}`}
          onClick={() => onChange(i)} className="rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400">
          <Star className={clsx('h-7 w-7 transition', i <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300 hover:text-amber-300')} />
        </button>
      ))}
    </div>
  )
}
