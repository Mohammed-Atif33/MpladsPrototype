import { Input } from '../ui'
import { inr } from '../../lib/format'

/** Rupee amount input (plain number) with a live lakh/crore preview. */
export default function MoneyInput({ value, onChange, ...rest }) {
  const n = Number(value)
  return (
    <div>
      <Input type="number" min="0" step="1000" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
      <p className="hint">{value !== '' && !Number.isNaN(n) ? `= ${inr(n)}  (₹${n.toLocaleString('en-IN')})` : 'Enter the amount in rupees, e.g. 1850000'}</p>
    </div>
  )
}
