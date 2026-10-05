import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { STATUS_META } from '../components/POView'
import { Badge, Card, Empty, Mono, Stat } from '../components/ui'
import { compactInr, inr, num } from '../lib/format'
import { useStore } from '../lib/store'

export default function CustomerDetail() {
  const { id = '' } = useParams()
  const { data, ctx, inbox, uploadResults } = useStore()
  const c = data?.customers.find((x) => x.customer_id === id)
  const txns = useMemo(() => ctx?.txnsByCustomer.get(id) ?? [], [ctx, id])
  const portfolio = useMemo(() => {
    const m = new Map<string, { sku: string; n: number; last: string; lastPrice: number; qty: number }>()
    for (const t of txns) {
      const r = m.get(t.sku) ?? { sku: t.sku, n: 0, last: '', lastPrice: 0, qty: 0 }
      r.n++; r.qty += t.quantity
      if (t.transaction_date >= r.last) { r.last = t.transaction_date; r.lastPrice = t.unit_price_inr }
      m.set(t.sku, r)
    }
    return [...m.values()].sort((a, b) => b.n - a.n)
  }, [txns])
  const [sku, setSku] = useState<string | null>(null)
  const active = sku ?? portfolio[0]?.sku ?? null
  const series = txns.filter((t) => t.sku === active).map((t) => ({ date: t.transaction_date, price: t.unit_price_inr }))
  const pos = [...uploadResults.values(), ...inbox].filter((p) => p.input.header.customer_id === id)

  if (!c || !ctx) return <Empty>Customer not found.</Empty>
  const p = active ? ctx.productBySku.get(active) : undefined

  return (
    <div className="space-y-5">
      <Link to="/customers" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" /> Customers</Link>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{c.customer_name} {c.is_new_customer && <Badge tone="review">new customer</Badge>}</h1>
        <p className="text-sm text-slate-500">{c.customer_id} · {c.customer_segment} · {c.city}, {c.state_code} · GSTIN {c.gstin_masked} · onboarded {c.onboarding_date} · prefers {c.po_channel_preference}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Commercial tier" value={c.commercial_tier} sub={`${c.standard_discount_pct}% standard discount`} />
        <Stat label="Credit" value={compactInr(c.credit_limit_inr)} sub={`${c.credit_terms_days} days terms`} />
        <Stat label="Historical lines" value={num(txns.length)} sub={`${portfolio.length} distinct SKUs`} />
        <Stat label="Avg monthly order value" value={compactInr(c.avg_monthly_order_value_inr)} />
        <Stat label="Own item codes" value={c.uses_own_item_codes ? c.customer_code_prefix + '####' : 'No'} sub={c.uses_own_item_codes ? 'learned mappings apply' : ''} />
      </div>

      {portfolio.length > 0 ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Card title="Buying portfolio" subtitle="SKUs this customer has bought — the agent prefers these when a description is ambiguous">
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2">SKU</th><th className="px-2 py-2 text-right">Orders</th><th className="px-2 py-2">Last</th><th className="px-4 py-2 text-right">Last price</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {portfolio.map((r) => (
                    <tr key={r.sku} onClick={() => setSku(r.sku)} className={`cursor-pointer hover:bg-slate-50 ${r.sku === active ? 'bg-brand-50' : ''}`}>
                      <td className="px-4 py-1.5"><Mono className="text-brand-700">{r.sku}</Mono><div className="truncate text-xs text-slate-500">{ctx.productBySku.get(r.sku)?.product_name}</div></td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.n}</td>
                      <td className="px-2 py-1.5 text-xs text-slate-600">{r.last}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{inr(r.lastPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title={<>Price history · <Mono>{active}</Mono></>} subtitle={p ? `${p.product_name} · list ${inr(p.list_price_inr)} · tier price ${inr(p.list_price_inr * (1 - c.standard_discount_pct / 100))}` : ''}>
            <div className="h-80 p-3">
              <ResponsiveContainer>
                <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#ececea" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#52514e' }} axisLine={false} tickLine={false} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#52514e' }} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => `₹${v}`} />
                  <Tooltip formatter={(v) => inr(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Line dataKey="price" name="Transacted price" stroke="#2a78d6" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="px-5 pb-4 text-[11px] text-slate-500">Repeat prices are related but never identical (≈3% variation, 3.5% annual drift) — so the agent validates within tolerance bands, not exact equality, and treats references older than 180 days as stale.</p>
          </Card>
        </div>
      ) : (
        <Card className="p-6 text-sm text-slate-600">No transaction history. Every PO from this customer is routed to commercial review — there is no negotiated price to validate against.</Card>
      )}

      <Card title={`Purchase orders (${pos.length})`}>
        <div className="divide-y divide-slate-100">
          {pos.map((p) => (
            <Link key={p.input.header.po_id} to={`/po/${p.input.header.po_id}`} className="flex flex-wrap items-center gap-3 px-5 py-2 text-sm hover:bg-slate-50">
              <Mono className="w-44">{p.input.header.po_number}</Mono>
              <span className="text-xs text-slate-500">{p.input.header.po_date}</span>
              <span className="text-xs text-slate-500">{p.summary.auto + p.summary.autoFlagged}/{p.summary.lines} auto</span>
              <span className="ml-auto"><Badge tone={STATUS_META[p.summary.status].tone}>{STATUS_META[p.summary.status].label}</Badge></span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  )
}
