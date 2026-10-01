import { useMemo, useState } from 'react'
import { Badge, Button, Card, Mono, PageHeader, Select } from '../components/ui'
import { inr, num } from '../lib/format'
import { useStore } from '../lib/store'

const PAGE = 60

export default function Catalogue() {
  const { data } = useStore()
  const [q, setQ] = useState('')
  const [family, setFamily] = useState('all')
  const [grouped, setGrouped] = useState('groups')
  const [page, setPage] = useState(0)
  const products = data?.products ?? []
  const families = useMemo(() => [...new Set(products.map((p) => p.product_family))].sort(), [products])

  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return products.filter((p) => (family === 'all' || p.product_family === family) &&
      words.every((w) => `${p.sku} ${p.product_name} ${p.quality_group_id} ${p.finish}`.toLowerCase().includes(w)))
  }, [products, q, family])

  const groups = useMemo(() => {
    const m = new Map<string, typeof filtered>()
    for (const p of filtered) {
      if (!m.has(p.quality_group_id)) m.set(p.quality_group_id, [])
      m.get(p.quality_group_id)!.push(p)
    }
    return [...m.entries()]
  }, [filtered])

  return (
    <div>
      <PageHeader title="Product catalogue"
        subtitle="750 SKUs in 22 families. SKUs in a quality group share composition, construction, GSM and width and differ only by colour — which is why a PO line without a colour genuinely maps to several SKUs." />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Search e.g. “poplin 120 navy”, “DD-DNM”…" className="w-72 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <Select label="Family" value={family} onChange={(v) => { setFamily(v); setPage(0) }} options={[{ value: 'all', label: 'All families' }, ...families.map((f) => ({ value: f, label: f }))]} />
          <Select label="View" value={grouped} onChange={(v) => { setGrouped(v); setPage(0) }} options={[{ value: 'groups', label: 'Quality groups' }, { value: 'skus', label: 'Flat SKU list' }]} />
          <span className="ml-auto text-xs text-slate-500">{num(filtered.length)} SKUs · {num(groups.length)} quality groups</span>
        </div>
        {grouped === 'groups' ? (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {groups.slice(page * 24, page * 24 + 24).map(([qid, ps]) => {
              const p0 = ps[0]
              return (
                <div key={qid} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{p0.composition} {p0.sub_category}</div>
                      <div className="text-xs text-slate-500">{p0.gsm} GSM · {p0.width_inch ? `${p0.width_inch}"` : p0.size_spec} · {p0.finish} · per {p0.uom}</div>
                    </div>
                    <Mono className="text-slate-400">{qid}</Mono>
                  </div>
                  <ul className="mt-2 space-y-0.5">
                    {ps.map((p) => (
                      <li key={p.sku} className="flex items-center gap-2 text-xs">
                        <Mono className="w-24 text-brand-700">{p.sku}</Mono>
                        <span className="flex-1">{p.colour}</span>
                        {!p.is_active && <Badge tone="reject">discontinued</Badge>}
                        <span className="tabular-nums text-slate-600">{inr(p.list_price_inr)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-2">SKU</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Family</th><th className="px-3 py-2 text-right">List price</th>
                  <th className="px-3 py-2">UOM</th><th className="px-3 py-2 text-right">MOQ</th><th className="px-3 py-2">HSN / GST</th><th className="px-5 py-2">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.slice(page * PAGE, page * PAGE + PAGE).map((p) => (
                  <tr key={p.sku}>
                    <td className="px-5 py-1.5"><Mono className="text-brand-700">{p.sku}</Mono></td>
                    <td className="px-3 py-1.5">{p.product_name}</td>
                    <td className="px-3 py-1.5 text-slate-600">{p.product_family}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{inr(p.list_price_inr)}</td>
                    <td className="px-3 py-1.5">{p.uom}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.moq_units}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{p.hsn_code} · {p.gst_rate_pct}%</td>
                    <td className="px-5 py-1.5">{p.is_active ? <Badge tone="good">active</Badge> : <Badge tone="reject">discontinued</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-2.5">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button variant="secondary" disabled={(page + 1) * (grouped === 'groups' ? 24 : PAGE) >= (grouped === 'groups' ? groups.length : filtered.length)} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </Card>
    </div>
  )
}
