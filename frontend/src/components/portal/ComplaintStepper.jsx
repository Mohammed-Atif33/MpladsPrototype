import clsx from 'clsx'
import { Check } from 'lucide-react'

/** 8-step complaint tracking: Submit -> Tracking ID -> Screening -> Assignment -> Investigation -> Resolution -> Feedback -> Appeal/Close */
export default function ComplaintStepper({ steps = [] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
      {steps.map((s, i) => (
        <li key={s.step} className="flex items-center gap-2.5 sm:flex-col sm:items-center sm:text-center">
          <div className="relative flex items-center sm:w-full sm:justify-center">
            {i > 0 && <span className={clsx('absolute right-1/2 top-1/2 hidden h-0.5 w-full -translate-y-1/2 lg:block', s.done || s.current ? 'bg-navy-600' : 'bg-slate-200')} />}
            <span className={clsx('relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
              s.done ? 'border-navy-600 bg-navy-600 text-white' : s.current ? 'border-amber-500 bg-amber-50 text-amber-700 ring-4 ring-amber-100' : 'border-slate-300 bg-white text-slate-400')}>
              {s.done ? <Check className="h-4 w-4" /> : i + 1}
            </span>
          </div>
          <div className={clsx('text-xs leading-tight', s.done ? 'font-medium text-slate-800' : s.current ? 'font-semibold text-amber-700' : 'text-slate-400')}>{s.step}</div>
        </li>
      ))}
    </ol>
  )
}
