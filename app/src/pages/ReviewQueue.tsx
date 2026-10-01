import clsx from 'clsx'
import { CheckCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import LineResultCard, { LineTableHeader } from '../components/LineResultCard'
import { Card, Empty, Mono, PageHeader, Select } from '../components/ui'
import type { LineResult, POResult } from '../lib/engine'
import { ACTION_META, num } from '../lib/format'
import { useStore } from '../lib/store'
import type { Action } from '../lib/types'

const QUEUES: { key: Action | 'all'; label: string; hint: string }[] = [
  { key: 'all', label: 'All open', hint: 'Everything waiting on a person' },
  { key: 'review_match', label: 'Product match', hint: 'Ambiguous, partial, conflicting attributes or unmapped codes — pick the SKU' },
  { key: 'review_price', label: 'Price', hint: 'Quote > 5% off reference, or a new customer with no negotiated price' },
  { key: 'request_clarification', label: 'Clarify with customer', hint: 'Missing quantity or remarks that contradict the line' },
  { key: 'manual_entry', label: 'Manual entry', hint: 'Illegible scans or free text like "same as last order"' },
  { key: 'hold_duplicate_check', label: 'Duplicates', hint: 'Whole PO looks like a re-send of an earlier one' },
  { key: 'review_uom', label: 'UOM', hint: 'Ordered in KG for a metre SKU (or vice versa) — needs yield data' },
  { key: 'review_quantity', label: 'Quantity', hint: 'Far above this customer\'s normal line size — keying error?' },
]

export default function ReviewQueue() {
  const { inbox, uploadResults, reviews, data } = useStore()
  const [queue, setQueue] = useState<Action | 'all'>('all')
  const [showDone, setShowDone] = useState('open')
  const [limit, setLimit] = useState(30)

  const items = useMemo(() => {
    const out: { l: LineResult; po: POResult }[] = []
    for (const po of [...uploadResults.values(), ...[...inbox].reverse()])
      for (const l of po.lines) if (!l.autoProcess && l.action !== 'reject_line') out.push({ l, po })
    return out
  }, [inbox, uploadResults])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const { l } of items) if (!reviews[l.input.po_line_id]) {
      m.set(l.action, (m.get(l.action) ?? 0) + 1)
      m.set('all', (m.get('all') ?? 0) + 1)
    }
    return m
  }, [items, reviews])

  const filtered = items.filter(({ l }) => (queue === 'all' || l.action === queue) &&
    (showDone === 'all' || (showDone === 'open' ? !reviews[l.input.po_line_id] : !!reviews[l.input.po_line_id])))
  const done = Object.keys(reviews).length

  return (
    <div>
      <PageHeader title="Review queue"
        subtitle="Lines the agent refused to auto-approve, routed by the kind of human judgement they need. Approving a line moves it into the sales order; approving a customer-coded line teaches the agent that code." />
      <div className="mb-4 flex flex-wrap gap-2">
        {QUEUES.map((qd) => (
          <button key={qd.key} onClick={() => { setQueue(qd.key); setLimit(30) }} title={qd.hint}
            className={clsx('rounded-lg border px-3 py-2 text-left text-sm transition', queue === qd.key ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-surface text-slate-700 hover:border-slate-300')}>
            <div className="font-medium">{qd.label}</div>
            <div className="text-xs tabular-nums text-slate-500">{num(counts.get(qd.key) ?? 0)} open</div>
          </button>
        ))}
      </div>
      <Card title={queue === 'all' ? 'All open items' : ACTION_META[queue].label} subtitle={QUEUES.find((x) => x.key === queue)?.hint}
        action={<div className="flex items-center gap-3"><span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCheck className="h-3.5 w-3.5" />{done} decided</span>
          <Select value={showDone} onChange={setShowDone} options={[{ value: 'open', label: 'Open' }, { value: 'decided', label: 'Decided' }, { value: 'all', label: 'All' }]} /></div>}>
        <LineTableHeader />
        {filtered.length === 0 && <Empty>Nothing here. 🎉</Empty>}
        {filtered.slice(0, limit).map(({ l, po }) => (
          <div key={l.input.po_line_id}>
            <div className="flex items-center gap-2 bg-slate-50 px-4 pt-2 text-[11px] text-slate-500">
              <Link to={`/po/${po.input.header.po_id}`} className="hover:underline"><Mono className="text-brand-700">{po.input.header.po_number}</Mono></Link>
              <span>· {po.customer?.customer_name ?? po.input.customer_name_text}</span><span>· {po.input.header.po_date}</span>
            </div>
            <LineResultCard l={l} gt={data?.gt.get(l.input.ref_line_id ?? l.input.po_line_id)} customerId={po.input.header.customer_id} />
          </div>
        ))}
        {filtered.length > limit && (
          <div className="p-4 text-center"><button className="text-sm font-medium text-brand-600 hover:underline" onClick={() => setLimit(limit + 30)}>Show more ({num(filtered.length - limit)} remaining)</button></div>
        )}
      </Card>
    </div>
  )
}
