import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card, Mono, PageHeader, Select } from '../components/ui'
import { compactInr, num } from '../lib/format'
import { useStore } from '../lib/store'

export default function Customers() {
  const { data, inbox } = useStore()
  const [q, setQ] = useState('')
  const [seg, setSeg] = useState('all')
  const customers = data?.customers ?? []
  const segs = [...new Set(customers.map((c) => c.customer_segment))].sort()
  const stats = useMemo(() => {
    const m = new Map<string, { pos: number; lines: number; auto: number }>()
    for (const p of inbox) {
      const k = p.input.header.customer_id
      const s = m.get(k) ?? { pos: 0, lines: 0, auto: 0 }
      s.pos++; s.lines += p.lines.length; s.auto += p.lines.filter((l) => l.autoProcess).length
      m.set(k, s)
    }
    return m
  }, [inbox])
  const rows = customers.filter((c) => (seg === 'all' || c.customer_segment === seg) && (!q || `${c.customer_id} ${c.customer_name} ${c.city}`.toLowerCase().includes(q.toLowerCase())))

  return (
    <div>
      <PageHeader title="Customers" subtitle="Commercial profile per buyer. Tier sets the standard discount; history sets the negotiated reference prices the agent validates against." />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer or city…" className="w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <Select label="Segment" value={seg} onChange={setSeg} options={[{ value: 'all', label: 'All segments' }, ...segs.map((s) => ({ value: s, label: s }))]} />
          <span className="ml-auto text-xs text-slate-500">{rows.length} customers</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-2">Customer</th><th className="px-3 py-2">Segment</th><th className="px-3 py-2">City</th><th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Own codes</th><th className="px-3 py-2 text-right">Avg monthly</th><th className="px-3 py-2 text-right">POs</th><th className="px-5 py-2 text-right">Lines auto</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => {
                const s = stats.get(c.customer_id)
                return (
                  <tr key={c.customer_id} className="hover:bg-slate-50">
                    <td className="px-5 py-1.5"><Link to={`/customers/${c.customer_id}`} className="font-medium text-brand-700 hover:underline">{c.customer_name}</Link>
                      <div className="text-[11px] text-slate-400">{c.customer_id}</div></td>
                    <td className="px-3 py-1.5 text-slate-600">{c.customer_segment}</td>
                    <td className="px-3 py-1.5 text-slate-600">{c.city}</td>
                    <td className="px-3 py-1.5">{c.commercial_tier} <span className="text-xs text-slate-400">(−{c.standard_discount_pct}%)</span></td>
                    <td className="px-3 py-1.5">{c.uses_own_item_codes ? <Mono>{c.customer_code_prefix}####</Mono> : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{c.is_new_customer ? <Badge tone="review">new</Badge> : compactInr(c.avg_monthly_order_value_inr)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{num(s?.pos ?? 0)}</td>
                    <td className="px-5 py-1.5 text-right tabular-nums">{s ? `${Math.round((s.auto / s.lines) * 100)}%` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
