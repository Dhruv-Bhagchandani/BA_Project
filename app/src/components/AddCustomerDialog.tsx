import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { TIER_DISCOUNT_PCT, useStore } from '../lib/store'
import type { Customer } from '../lib/types'
import { Button } from './ui'

const CHANNELS = ['Email PDF', 'Email Excel', 'WhatsApp Image', 'Portal Upload', 'Scanned Copy']
const SEGMENTS = ['Garment Exporter', 'Domestic Apparel Brand', 'Wholesaler / Trader', 'Institutional / Uniform', 'Home Furnishing Retailer', 'Boutique / Designer']
const TIER_HINT: Record<Customer['commercial_tier'], string> = {
  A: 'Tier A: largest accounts, 12% off list',
  B: 'Tier B: regular accounts, 7% off list',
  C: 'Tier C: small or occasional accounts, 3% off list',
}

const input = 'mt-1 w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20'
const label = 'block text-xs font-medium text-slate-600'

export default function AddCustomerDialog({ onClose, onCreated }: { onClose: () => void; onCreated?: (c: Customer) => void }) {
  const { data, addCustomer } = useStore()
  const cities = useMemo(() => [...new Set((data?.customers ?? []).map((c) => `${c.city}|${c.state_code}`))].sort(), [data])

  const [name, setName] = useState('')
  const [segment, setSegment] = useState(SEGMENTS[2])
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [gstin, setGstin] = useState('')
  const [tier, setTier] = useState<Customer['commercial_tier']>('B')
  const [terms, setTerms] = useState('30')
  const [limit, setLimit] = useState('500000')
  const [uom, setUom] = useState('MTR')
  const [channel, setChannel] = useState(CHANNELS[0])
  const [ownCodes, setOwnCodes] = useState(false)
  const [prefix, setPrefix] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const errors: Record<string, string> = {}
  if (!name.trim()) errors.name = 'Enter the customer name.'
  else if (data?.customers.some((c) => c.customer_name.toLowerCase() === name.trim().toLowerCase())) errors.name = 'A customer with this name already exists.'
  if (!city.trim()) errors.city = 'Enter the city.'
  if (!/^[A-Za-z]{2}$/.test(state.trim())) errors.state = 'Use the 2-letter state code, for example GJ.'
  if (!(Number(terms) >= 0)) errors.terms = 'Enter the number of days (0 or more).'
  if (!(Number(limit) > 0)) errors.limit = 'Enter a credit limit above 0.'
  if (ownCodes && !/^[A-Za-z]{2,4}-$/.test(prefix.trim())) errors.prefix = 'Use 2 to 4 letters and a dash, for example SUN-.'
  const valid = Object.keys(errors).length === 0

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!valid) return
    const created = addCustomer({
      customer_name: name, customer_segment: segment, city, state_code: state, commercial_tier: tier,
      credit_terms_days: Number(terms), credit_limit_inr: Number(limit), preferred_uom: uom,
      uses_own_item_codes: ownCodes, customer_code_prefix: prefix, po_channel_preference: channel, gstin,
    })
    onCreated?.(created)
    onClose()
  }

  const err = (k: string) => touched && errors[k] && <span className="mt-1 block text-[11px] text-red-700">{errors[k]}</span>

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="add-cust-title" noValidate
        className="w-full max-w-2xl rounded-xl border border-slate-200 bg-surface shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 id="add-cust-title" className="text-base font-semibold text-slate-900">Add a customer</h2>
            <p className="mt-0.5 text-xs text-slate-500">Saved in this browser. You can pick them as the buyer when you process a PO.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </header>

        <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>Customer name *
            <input id="cust-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunrise Textiles" className={input} />
            {err('name')}
          </label>
          <label className={label}>Segment
            <select id="cust-segment" value={segment} onChange={(e) => setSegment(e.target.value)} className={input}>
              {SEGMENTS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className={label}>Usual way POs arrive
            <select id="cust-channel" value={channel} onChange={(e) => setChannel(e.target.value)} className={input}>
              {CHANNELS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className={label}>City *
            <input id="cust-city" list="cust-cities" value={city} onChange={(e) => {
              setCity(e.target.value)
              const hit = cities.find((c) => c.split('|')[0].toLowerCase() === e.target.value.trim().toLowerCase())
              if (hit && !state) setState(hit.split('|')[1])
            }} placeholder="e.g. Surat" className={input} />
            <datalist id="cust-cities">{cities.map((c) => <option key={c} value={c.split('|')[0]} />)}</datalist>
            {err('city')}
          </label>
          <label className={label}>State code *
            <input id="cust-state" value={state} maxLength={2} onChange={(e) => setState(e.target.value.toUpperCase())} placeholder="GJ" className={input} />
            {err('state')}
          </label>
          <label className={`${label} sm:col-span-2`}>GSTIN (optional)
            <input id="cust-gstin" value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="Leave blank to use a placeholder" className={`${input} font-mono`} />
          </label>

          <fieldset className="sm:col-span-2">
            <legend className={label}>Commercial tier (sets the standard discount)</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              {(['A', 'B', 'C'] as const).map((t) => (
                <label key={t} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs ${tier === t ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}>
                  <input type="radio" name="tier" checked={tier === t} onChange={() => setTier(t)} className="mt-0.5" />
                  <span><b className="text-slate-900">Tier {t} · {TIER_DISCOUNT_PCT[t]}% off</b><br /><span className="text-slate-500">{TIER_HINT[t].split(': ')[1].replace(/, \d+% off list/, '')}</span></span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className={label}>Payment terms (days)
            <input id="cust-terms" inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} className={input} />
            {err('terms')}
          </label>
          <label className={label}>Credit limit (₹)
            <input id="cust-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} className={input} />
            {err('limit')}
          </label>
          <label className={label}>Usually orders in
            <select id="cust-uom" value={uom} onChange={(e) => setUom(e.target.value)} className={input}>
              <option value="MTR">Metres (MTR)</option><option value="KG">Kilograms (KG)</option><option value="PCS">Pieces (PCS)</option>
            </select>
          </label>
          <div>
            <label className="mt-6 flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
              <input id="cust-own-codes" type="checkbox" checked={ownCodes} onChange={(e) => setOwnCodes(e.target.checked)} />
              Uses their own item codes on POs
            </label>
            {ownCodes && (
              <label className={`${label} mt-2`}>Code prefix
                <input id="cust-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="SUN-" className={`${input} font-mono`} />
                {err('prefix')}
              </label>
            )}
          </div>
        </div>

        <div className="mx-6 mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          New customers have no order history, so the agent sends their first orders to a person for price review instead of approving them automatically.
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit">Add customer</Button>
        </footer>
      </form>
    </div>
  )
}
