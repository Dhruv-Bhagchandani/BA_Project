import type { Action, ExceptionType } from './types'

const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
export const inr = (n: number | null | undefined, whole = false) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : (whole ? inr0 : inrFmt).format(n)

export const compactInr = (n: number) => {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`
  return inr(n, true)
}
export const num = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: d })
export const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(d)}%`)
export const human = (s: string) => s.replace(/_/g, ' ')

export type Tone = 'good' | 'flag' | 'review' | 'clarify' | 'hold' | 'reject' | 'manual' | 'neutral' | 'info'

export const ACTION_META: Record<Action, { label: string; tone: Tone; short: string }> = {
  auto_process: { label: 'Auto-approved', short: 'Auto', tone: 'good' },
  auto_process_with_flag: { label: 'Auto-approved · flagged', short: 'Auto + flag', tone: 'flag' },
  review_match: { label: 'Review product match', short: 'Review match', tone: 'review' },
  review_price: { label: 'Review price', short: 'Review price', tone: 'review' },
  review_uom: { label: 'Review unit of measure', short: 'Review UOM', tone: 'review' },
  review_quantity: { label: 'Review quantity', short: 'Review qty', tone: 'review' },
  request_clarification: { label: 'Ask customer to clarify', short: 'Clarify', tone: 'clarify' },
  hold_duplicate_check: { label: 'Hold — possible duplicate', short: 'Duplicate hold', tone: 'hold' },
  manual_entry: { label: 'Manual entry', short: 'Manual', tone: 'manual' },
  reject_line: { label: 'Reject line', short: 'Reject', tone: 'reject' },
}

export const EXCEPTION_LABEL: Record<ExceptionType, string> = {
  none: 'No exception',
  price_variance_minor: 'Price variance 2–5%',
  price_variance_major: 'Price variance > 5%',
  uom_mismatch: 'UOM not convertible',
  uom_converted: 'UOM converted (yd → m)',
  missing_quantity: 'Missing quantity',
  unknown_product: 'Unknown product',
  duplicate_order: 'Duplicate PO',
  attribute_conflict: 'Attribute conflict',
  ambiguous_match: 'Ambiguous match',
  partial_match: 'Variant not offered',
  illegible_document: 'Illegible document',
  conflicting_data: 'Conflicting instructions',
  quantity_outlier: 'Quantity outlier',
  incomplete_line: 'Incomplete line',
  unmapped_customer_code: 'Unmapped customer code',
  stale_reference_price: 'Stale reference price',
  no_reference_price: 'No customer price history',
  low_confidence_match: 'Low-confidence match',
  new_customer_no_history: 'New customer',
}

export const TONE_CLASS: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  flag: 'bg-teal-50 text-teal-800 ring-teal-600/20',
  review: 'bg-amber-50 text-amber-900 ring-amber-600/25',
  clarify: 'bg-orange-50 text-orange-900 ring-orange-600/25',
  hold: 'bg-violet-50 text-violet-800 ring-violet-600/20',
  reject: 'bg-red-50 text-red-800 ring-red-600/20',
  manual: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  info: 'bg-brand-50 text-brand-700 ring-brand-600/20',
}

export const download = (name: string, content: string, type = 'text/csv') => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
